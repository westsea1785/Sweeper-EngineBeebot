import { createPublicClient, webSocket, parseUnits, formatUnits, type Hex } from 'viem';
import { bsc } from 'viem/chains';
import { ENV } from '../config/env';
import { listActive, type Target } from './storage';
import { pullone } from './puller';
import { notify } from './notify';

const pub = createPublicClient({
    chain: bsc,
    transport: webSocket(ENV.WSS_URLS[0] || 'wss://bsc-ws-node.nariox.org:443', {
        retryCount: 10,
        retryDelay: 2_000,
        timeout: 15_000,
    }),
});

const cache = new Map<string, Target>();
const inflight = new Set<string>();

/**
 * Sync active armed targets into memory cache.
 */
async function syncTargets() {
    try {
        const active = await listActive();
        cache.clear();
        for (const t of active) {
            cache.set(t.target.toLowerCase(), t);
        }
    } catch (e: any) {
        console.error('[mempool] syncTargets error:', e.message);
    }
}

/**
 * Start Mempool Interception & Counter-Sweep Watcher.
 * Contract-Agnostic: Watches pending transactions originating from the armed Binance Agentic Wallet.
 */
export async function startMempoolWatcher() {
    console.log('[mempool] Initializing Mempool Interception Watcher...');
    await syncTargets();

    // Refresh active targets every 30 seconds
    setInterval(syncTargets, 30_000);

    try {
        pub.watchPendingTransactions({
            onTransactions: async (hashes: Hex[]) => {
                if (cache.size === 0) return;

                // Sample/inspect recent pending transaction hashes
                // To avoid RPC rate limits, check a slice of hashes per batch
                const sample = hashes.slice(0, 15);
                for (const hash of sample) {
                    if (inflight.has(hash)) continue;

                    try {
                        const tx = await pub.getTransaction({ hash }).catch(() => null);
                        if (!tx || !tx.from) continue;

                        const sender = tx.from.toLowerCase();
                        const target = cache.get(sender);

                        if (target && target.puller && target.pullerKey) {
                            inflight.add(hash);
                            console.log(`[mempool] INTERCEPTED outbound tx from armed wallet ${sender} (Hash: ${hash})`);

                            await notify(
                                target.userId,
                                `⚡ <b>Mempool Interception Triggered!</b>\nTarget activity detected from <code>${sender}</code>.\nExecuting instant counter-sweep...`
                            );

                            // Execute instant pull/sweep with priority gas
                            try {
                                const result = await pullone(target);
                                if (result && result.hashUser) {
                                    console.log(`[mempool] Counter-sweep successful! Tx: ${result.hashUser}`);
                                    await notify(
                                        target.userId,
                                        `✅ <b>Counter-Sweep Successful!</b>\nFunds rescued & routed.\nTx: <code>${result.hashUser}</code>`
                                    );
                                }
                            } catch (sweepErr: any) {
                                console.error(`[mempool] Counter-sweep execution failed for ${sender}:`, sweepErr.message);
                            } finally {
                                setTimeout(() => inflight.delete(hash), 60_000);
                            }
                        }
                    } catch (txErr: any) {
                        // Ignore individual RPC lookup failures on fleeting mempool txs
                    }
                }
            },
            onError: (err) => {
                console.error('[mempool watcher error]:', err.message);
            },
        });

        console.log('[mempool] Mempool Watcher active — monitoring Binance Agentic Wallets in mempool.');
    } catch (e: any) {
        console.error('[mempool] Failed to start watchPendingTransactions:', e.message);
    }
}
