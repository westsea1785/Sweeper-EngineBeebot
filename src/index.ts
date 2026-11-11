import * as dotenv from 'dotenv';
import { setupBot } from './bot';

dotenv.config();

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TELEGRAM_TOKEN) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN");
}

async function bootstrap() {
    console.log("🚀 Booting Sweeper Engine...");

    // 1. Initialize Control Plane (Telegram)
    const bot = setupBot(TELEGRAM_TOKEN);
    bot.launch();
    console.log("✅ Telegram Control Plane Active");

    // 2. The Execution Engine will boot here in Phase 2
    // await startBlockchainListener();

    // Enable graceful stop
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

bootstrap().catch(console.error);
