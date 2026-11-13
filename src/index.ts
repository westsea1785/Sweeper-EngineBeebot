import { ENV } from './config/env';
import { migrate } from './config/db';
import { buildBot } from './bot';
import { setNotifier } from './engine/notify';
import { startEngine } from './engine/listener';

async function main() {
  console.log('booting…');
  await migrate();

  const bot = buildBot();
  await bot.launch();
  setNotifier((userId, text) =>
    bot.telegram.sendMessage(userId, text, {
      parse_mode: 'Markdown',
      link_preview_options: { is_disabled: true },
    }));
  console.log('control plane up');

  await startEngine();

  const stop = (s: string) => { console.log(`${s} — exit`); bot.stop(s); process.exit(0); };
  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));
}

main().catch(e => { console.error(e); process.exit(1); });
