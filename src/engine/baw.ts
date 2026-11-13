import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { ENV } from '../config/env';
import { CHAIN, MAX_UINT } from '../config/constants';

const run = promisify(execFile);
const HOOK = `${ENV.BAW_ROOT}/keytar-off.mjs`;

export interface SessionRef { dir: string; instanceId: string }

const envFor = (s: SessionRef) => ({
  ...process.env,
  BINANCE_BAW_DIR: `${ENV.BAW_ROOT}/${s.dir}`,
  BINANCE_INSTANCE_ID: s.instanceId,
  ...(existsSync(HOOK) ? { NODE_OPTIONS: `--import ${HOOK}` } : {}),
});

export async function checkBaw(): Promise<string> {
  const { stdout } = await run(ENV.BAW_BIN, ['--version'], { timeout: 15000 });
  return stdout.trim();
}

export async function call<T = any>(s: SessionRef, args: string[], timeout = 20000): Promise<T> {
  let stdout: string;
  try {
    ({ stdout } = await run(ENV.BAW_BIN, [...args, '--json'], {
      env: envFor(s), timeout, maxBuffer: 4 << 20,
    }));
  } catch (e: any) {
    if (e.code === 'ENOENT') {
      throw new Error(`baw not installed (${ENV.BAW_BIN}) — build step must run npm i -g @binance/agentic-wallet`);
    }
    throw e;
  }
  const line = stdout.trim().split('\n').filter(l => l.trim().startsWith('{')).pop();
  if (!line) throw new Error('no JSON from baw: ' + stdout.slice(0, 200));
  return JSON.parse(line) as T;
}

export const status = (s: SessionRef) => call(s, ['wallet', 'status'], 8000);

export const address = (s: SessionRef) =>
  call<{ data: { addresses: { binanceChainId: string; address: string }[] } }>(
    s, ['wallet', 'address'], 10000);

export const txLock = (s: SessionRef) =>
  call<{ data: { status: string } }>(s, ['wallet', 'tx-lock', '--binanceChainId', CHAIN], 8000);

export const sendMax = (s: SessionRef, asset: string, dest: string) =>
  call<{ data?: { txHash?: string } }>(s, [
    'wallet', 'send', '--max', '--recipient', dest,
    '--binanceChainId', CHAIN, '--tokenAddress', asset, '--gasLevel', 'HIGH',
  ], 25000);

export const signin = (s: SessionRef) =>
  call<{ data: { urlForWeb: string; pairingCode: string; qrCodeId: string } }>(
    s, ['auth', 'signin'], 15000);

export const verify = (s: SessionRef, qrCodeId: string) =>
  call(s, ['auth', 'verify', '--qrCodeId', qrCodeId], 330000);

export async function grantAllowance(s: SessionRef, token: string, puller: string) {
  const p = await call<{ data: { requestId: string } }>(s, [
    'contract-call', 'preview', '--binanceChainId', CHAIN,
    '--to', token, '--function', 'approve(address,uint256)',
    '--args', `${puller},${MAX_UINT}`,
  ], 25000);
  await call(s, ['contract-call', 'execute', '--binanceChainId', CHAIN, '--requestId', p.data.requestId], 25000);
}
