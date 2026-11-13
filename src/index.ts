import http from 'node:http';
import { ENV } from './config/env';
import { migrate } from './config/db';
import { buildBot } from './bot';
import { setBotUsername } from './bot/state';
import { setNotifier } from './engine/notify';
import { startEngine, engineState } from './engine/listener';
import { checkBaw } from './engine/baw';

const log = (m: string) => console.log(`[boot] ${m}`);

async function main() {
  log('start');
  await migrate();
  log('db ok');

  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(engineState));
    }
    res.writeHead(404).end();
  });
  server.listen(Number(process.env.PORT) || 3000, () => log('health server up'));

  try {
    log(`baw ${await checkBaw()}`);
  } catch (e: any) {
    log(`BAW MISSING: ${e.message}`);
  }

  // engine first — a hung bot.launch() must not stop sweeping
  await startEngine();
  log('engine started');

  const bot = buildBot();
  log('bot built');

  void bot.launch({ dropPendingUpdates: true })
    .then(async () => {
      log('control plane up');
      const me = await bot.telegram.getMe();
      setBotUsername(me.username);
      log(`username @${me.username}`);
    })
    .catch(e => log(`LAUNCH FAILED: ${e.message}`));

  setNotifier((userId, text) =>
    bot.telegram.sendMessage(userId, text, {
      parse_mode: 'HTML', link_preview_options: { is_disabled: true },
    }));

  setInterval(() => {
    console.log(`[hb] armed=${engineState.armed} targets=${engineState.targets} block=${engineState.lastBlock}`);
  }, 60_000);

  const stop = (s: string) => { log(`${s} exit`); bot.stop(s); server.close(); process.exit(0); };
  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));
}

main().catch(e => { console.error('[boot] FATAL', e); process.exit(1); });
