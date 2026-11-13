import { status, txLock } from '../engine/baw';

const [target] = process.argv.slice(2);
if (!target) { console.error('usage: npm run watch-session -- <wallet>'); process.exit(1); }
const sref = { dir: `t${target}`, instanceId: process.env.INSTANCE_ID! };
const t0 = Date.now();
const ts = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;
let ls = '', ll = '';

console.log(`watching ${target} — start the bot\n`);
setInterval(async () => {
  const s = await status(sref).then(r => r.data.status).catch(() => 'UNCONNECTED');
  const l = await txLock(sref).then(r => r.data.status).catch(() => 'ERR');
  if (s !== ls) console.log(`${ts()} SESSION ${s}${s === 'UNCONNECTED' ? '  <-- KICKED' : ''}`);
  if (l !== ll) console.log(`${ts()} TXLOCK ${l}`);
  ls = s; ll = l;
}, 1200);
