import { status, txLock, address } from '../engine/baw';

const [userId, target] = process.argv.slice(2);
if (!userId || !target) {
  console.error('usage: npm run watch-session -- <userId> <wallet>');
  process.exit(1);
}
const sref = { dir: `t${target}`, instanceId: process.env.INSTANCE_ID! };
const t0 = Date.now();
const ts = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;
let lastS = '', lastL = '';

console.log(`watching ${target} — start the bot now\n`);
setInterval(async () => {
  const s = await status(sref).then(r => r.data.status).catch(() => 'UNCONNECTED');
  const l = await txLock(sref).then(r => r.data.status).catch(() => 'ERR');
  if (s !== lastS) console.log(`${ts()} SESSION ${s}${s === 'UNCONNECTED' ? '  <-- KICKED' : ''}`);
  if (l !== lastL) console.log(`${ts()} TXLOCK  ${l}`);
  lastS = s; lastL = l;
}, 1200);
