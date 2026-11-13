import 'dotenv/config';

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

const keyHex = req('ENCRYPTION_KEY');
if (!/^[0-9a-f]{64}$/i.test(keyHex)) {
  throw new Error('ENCRYPTION_KEY must be 64 hex chars — generate with: openssl rand -hex 32');
}

export const ENV = {
  TOKEN: req('TELEGRAM_BOT_TOKEN'),
  ADMIN_ID: Number(req('ADMIN_TELEGRAM_ID')),
  DATABASE_URL: req('DATABASE_URL'),
  REDIS_URL: req('REDIS_URL'),
  ENCRYPTION_KEY: keyHex,
  WSS_URLS: req('WSS_URLS').split(',').map(s => s.trim()),
  HTTP_URLS: req('HTTP_URLS').split(',').map(s => s.trim()),
  BAW_BIN: process.env.BAW_BIN || 'baw',
  BAW_ROOT: process.env.BAW_ROOT || '/var/lib/baw',
  USDT: (process.env.USDT_ADDRESS || '0x55d398326f99059fF775485246999027B3197955').toLowerCase(),
  ENABLE_BNB_LEG: process.env.ENABLE_BNB_LEG === 'true',
  MIN_PULLER_GAS_WEI: BigInt(process.env.MIN_PULLER_GAS_WEI || '2000000000000000'),
};
