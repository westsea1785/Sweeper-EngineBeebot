import * as dotenv from 'dotenv';
import { setupBot } from './bot';
import { initializeDatabase } from './config/db';

dotenv.config();

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

async function bootstrap() {
    console.log("🚀 Booting Sweeper Engine...");

    // 1. Initialize Databases
    await initializeDatabase();

    // 2. Initialize Control Plane (Telegram)
    if (!TELEGRAM_TOKEN) throw new Error("Missing TELEGRAM_BOT_TOKEN");
    
    const bot = setupBot(TELEGRAM_TOKEN);
    bot.launch();
    console.log("✅ Telegram Control Plane Active");

    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

bootstrap().catch(console.error);
