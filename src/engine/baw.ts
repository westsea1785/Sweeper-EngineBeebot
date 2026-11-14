import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { encodeFunctionData, erc20Abi, parseUnits } from 'viem';
import { ENV } from '../config/env';
import { CHAIN } from '../config/constants';

const run = promisify(execFile);
process.env.BAW_DEBUG = 'true';

const HOOK = `${ENV.BAW_ROOT}/keytar-off.mjs`;
const DEBUG = true;

export interface SessionRef {
    dir: string;
    instanceId: string;
}

const envFor = (s: SessionRef) => ({
    ...process.env,
    BINANCE_BAW_DIR: `${ENV.BAW_ROOT}/${s.dir}`,
    BINANCE_INSTANCE_ID: s.instanceId,
    ...(existsSync(HOOK) ? { NODE_OPTIONS: `--import ${HOOK}` } : {}),
});

/** The CLI pretty-prints JSON. Slice from the first { to the last instead of line-parsing. */
function extractJson<T>(stdout: string): T {
    const t = stdout.trim();
    const attempt = (s: string): T | undefined => {
        try { return JSON.parse(s) as T; } catch { return undefined; }
    };
    const direct = attempt(t);
    if (direct !== undefined) return direct;

    const start = t.search(/[[{]/);
    const end = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
    if (start >= 0 && end > start) {
        const sliced = attempt(t.slice(start, end + 1));
        if (sliced !== undefined) return sliced;
    }
    throw new Error(`unparseable baw output: ${t.slice(0, 300)}`);
}

export async function checkBaw(): Promise<string> {
    const { stdout } = await run(ENV.BAW_BIN, ['--version'], { timeout: 15000 });
    return stdout.trim();
}

export async function call<T = any>(s: SessionRef, args: string[], timeout = 20000): Promise<T> {
    let stdout = '';
    let stderr = '';
    try {
        const r = await run(ENV.BAW_BIN, [...args, '--json'], {
            env: envFor(s),
            timeout,
            maxBuffer: 8 << 20,
        });
        stdout = r.stdout;
        stderr = r.stderr;
    } catch (e: any) {
        if (e.code === 'ENOENT') {
            throw new Error(`baw not installed (${ENV.BAW_BIN})`);
        }
        stdout = e.stdout ?? '';
        stderr = e.stderr ?? '';
        if (DEBUG) console.error('[baw:err]', args[0], stderr.slice(0, 500));
        if (!stdout.trim()) throw new Error(stderr.slice(0, 300) || e.message);
    }
    if (DEBUG) console.log('[baw:out]', args[0], stdout.slice(0, 800));

    const parsed = extractJson<T & { success?: boolean; error?: { message?: string } }>(stdout);
    if (parsed && parsed.success === false) {
        throw new Error(parsed.error?.message || 'baw returned success:false');
    }
    return parsed;
}

export const status = (s: SessionRef) => call(s, ['wallet', 'status'], 8000);

export const address = (s: SessionRef) =>
    call<{ data: { addresses: { binanceChainId: string; address: string }[] } }>(
        s, ['wallet', 'address'], 10000
    );

export const txLock = (s: SessionRef) =>
    call<{ data: { status: string } }>(s, ['wallet', 'tx-lock', '-binanceChainId', CHAIN], 8000);

export const sendMax = (s: SessionRef, asset: string, dest: string) =>
    call<{ data?: { txHash?: string } }>(s, [
        'wallet', 'send', 'max', 'recipient', dest,
        '-binanceChainId', CHAIN,
        '--tokenAddress', asset,
        '--gasLevel', 'HIGH',
    ], 25000);

export const signin = (s: SessionRef) =>
    call<{ data: { urlForWeb: string; pairingCode: string; qrCodeId: string } }>(
        s, ['auth', 'signin'], 20000
    );

export const verify = (s: SessionRef, qrCodeId: string) =>
    call(s, ['auth', 'verify', '--qrCodeId', qrCodeId], 330000);

export async function grantAllowance(s: SessionRef, token: string, puller: string, fromAddress: string) {
    const safeAllowance = parseUnits('200', 18);

    const inputData = encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [puller as `0x${string}`, safeAllowance],
    });

    const p = await call<{ data: { requestId: string } }>(s, [
        'contract-call', 'preview',
        '-binanceChainId', CHAIN,
        '--from', fromAddress,
        '--to', token,
        '--value', '0',
        '--inputData', inputData,
    ], 25000);

    await call(s, [
        'contract-call', 'execute',
        '-binanceChainId', CHAIN,
        '--requestId', p.data.requestId,
    ], 25000);
}
