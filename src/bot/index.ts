import { Telegraf } from 'telegraf';
import { inviteOnlyGuard, adminGuard } from './middleware';
import { mainDashboardKeyboard, adminPanelKeyboard } from './keyboards';

export const setupBot = (token: string) => {
    const bot = new Telegraf(token);

    // Global Error Handler - Prevents engine crashes from Telegram timeouts
    bot.catch((err, ctx) => {
        console.error(`[Bot Error] for ${ctx.updateType}:`, err);
    });

    // Apply strict invite-only access to all routes
    bot.use(inviteOnlyGuard);

    // Main Menu
    bot.start(async (ctx) => {
        await ctx.reply(
            "⚡️ *Sweeper Engine V1*\n\nEngine is online. Zero-latency routing active.\nSelect an action below:", 
            { parse_mode: 'Markdown', ...mainDashboardKeyboard }
        );
    });

    // Admin Panel Route
    bot.command('admin', adminGuard, async (ctx) => {
        await ctx.reply("🛡 *Admin Control Panel*", { 
            parse_mode: 'Markdown', 
            ...adminPanelKeyboard 
        });
    });

    // Placeholder for adding a wallet
    bot.action('ADD_TARGET', async (ctx) => {
        await ctx.answerCbQuery();
        await ctx.reply("Send the target EVM wallet address to monitor:");
        // Context/Session logic will go here to capture the next message
    });

    return bot;
};
