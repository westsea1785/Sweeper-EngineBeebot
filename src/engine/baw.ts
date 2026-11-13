import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ENV } from '../config/env';

const run = promisify(execFile);

export const NATIVE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
export const CHAIN = '56';
export const MAX_UINT = '115792089237316195423570985008687907853269984665640564039457584007913129639935';

export interface SessionRef { dir: string; instanceId: string }

const envFor = (s: SessionRef) => ({
  ...process.env,
  BINANCE_BAW_DIR: `${ENV.BAW_ROOT}/${s.dir}`,
  BINANCE_INSTANCE_ID: s.instanceId,
  NODE_OPTIONS: `--import ${ENV.BAW_ROOT}/keytar-off.mjs`,
});

export async function call<T = any>(s: SessionRef, args: string[], timeout = 20000): Promise<T> {
  const { stdout } = await run(ENV.BAW_BIN, [...args, '--json'], {
    env: envFor(s), timeout, maxBuffer: 4 << 20,
  });
  const line = stdout.trim().split('\n').filter(l => l.trim().startsWith('{')).pop();
  if (!line) throw new Error('no JSON from baw: ' + stdout.slice(0, 200));
  return JSON.parse(line) as T;
}

export const status = (s: SessionRef) => call(s, ['wallet', 'status'], 8000);
export const address = (s: SessionRef) =>
  call<{ data: { addresses: { binanceChainId: string; address: string }[] } }>(s, ['wallet', 'address'], 10000);
export const txLock = (s: SessionRef) =>
  call<{ data: { status: string } }>(s, ['wallet', 'tx-lock', '--binanceChainId', CHAIN], 8000);

export const sendMax = (s: SessionRef, asset: string, dest: string) =>
  call<{ data?: { txHash?: string } }>(s, [
    'wallet', 'send', '--max', '--recipient', dest,
    '--binanceChainId', CHAIN, '--tokenAddress', asset, '--gasLevel', 'HIGH',
  ], 25000);

export const signin = (s: SessionRef) =>
  call<{ data: { urlForWeb: string; pairingCode: string; qrCodeId: string } }>(s, ['auth', 'signin'], 15000);

export const verify = (s: SessionRef, qrCodeId: string) =>
  call(s, ['auth', 'verify', '--qrCodeId', qrCodeId], 330000);

/** One-time USDT allowance from the agentic wallet to the puller. Needs Developer Mode. */
export async function grantAllowance(s: SessionRef, token: string, puller: string) {
  const preview = await call<{ data: { requestId: string; parsedTx?: unknown } }>(s, [
    'contract-call', 'preview', '--binanceChainId', CHAIN,
    '--to', token, '--function', 'approve(address,uint256)',
    '--args', `${puller},${MAX_UINT}`,
  ], 25000);
  await call(s, [
    'contract-call', 'execute', '--binanceChainId', CHAIN,
    '--requestId', preview.data.requestId,
  ], 25000);
  return preview.data.requestId;
}
