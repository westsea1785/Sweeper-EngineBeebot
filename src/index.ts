import * as dotenv from 'dotenv';
import { setupBot } from './bot';
import { initializeDatabase } from './config/db';
import { startSweeperEngine } from './engine/listener';

dotenv.config();

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

async function bootstrap() {
    console.log("🚀 Booting Sweeper Engine...");

    await initializeDatabase();

    if (!TELEGRAM_TOKEN) throw new Error("Missing TELEGRAM_BOT_TOKEN");
    const bot = setupBot(TELEGRAM_TOKEN);
    bot.launch();
    console.log("✅ Telegram Control Plane Active");

    // Boot the execution engine
    await startSweeperEngine();

    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

bootstrap().catch(console.error);
