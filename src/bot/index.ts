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

        if (!userId) return;

        if (parts.length !== 2) {
            return ctx.reply("⚠️ Format: `/link_agent <destination_address>`", { parse_mode: 'Markdown' });
        }

        const destinationAddress = parts[1];
        await ctx.reply("🔗 *Generating Agentic Pairing Session...*", { parse_mode: 'Markdown' });

        try {
            // Instantly fetch sign-in link without blocking verification
            const { stdout } = await execAsync(`npx @binance/agentic-wallet auth signin --json`);
            const res = JSON.parse(stdout);

            if (res.success && res.data?.urlForWeb) {
                const { urlForWeb, pairingCode, qrCodeId, address: targetAddress } = res.data;
                
                await ctx.reply(
                    `🔐 *Binance Agentic Wallet Pairing*\n\n` +
                    `1. Confirm 6-character pairing code: \`${pairingCode}\`\n` +
                    `2. Enable *Secure Auto Sign* in your Binance App.\n\n` +
                    `[Authorize in Binance App](${urlForWeb})\n\n` +
                    `_Waiting for app authorization..._`,
                    { parse_mode: 'Markdown' }
                );

                // Non-blocking background verification check
                execAsync(`npx @binance/agentic-wallet auth verify --qrCodeId ${qrCodeId} --json`)
                    .then(async ({ stdout: verifyStdout }) => {
                        const verifyRes = JSON.parse(verifyStdout);
                        if (verifyRes.success) {
                            const resolvedAddress = targetAddress || verifyRes.data?.address;
                            if (resolvedAddress) {
                                await addSweepTarget(userId, resolvedAddress, destinationAddress, '', true);
                                await ctx.reply(`✅ *Binance Agentic Wallet Linked Successfully!*\nTarget Address: \`${resolvedAddress}\``, { parse_mode: 'Markdown' });
                            }
                        }
                    })
                    .catch(err => console.error("Async verification background error:", err));

            } else {
                await ctx.reply(`❌ CLI Error: ${res.error || res.message || 'Unknown response structure'}`);
            }
        } catch (error: any) {
            console.error("Agent link execution error details:", error);
            await ctx.reply(`❌ Detailed Error: ${error.message || error.toString()}`);
        }
    });

    // --- Dashboard Button Actions ---

    bot.action('ADD_TARGET', async (ctx) => {
        await ctx.answerCbQuery();
        await ctx.reply(
            "📝 *Add Target Wallet*\n\n" +
            "Choose your connection method:\n\n" +
            "1️⃣ *Standard Private Key*:\n`/add <private_key> <destination>`\n\n" +
            "2️⃣ *Binance Agentic Wallet*:\n`/link_agent <destination>`", 
            { parse_mode: 'Markdown' }
        );
    });

    bot.action('USER_GUIDE', async (ctx) => {
        await ctx.answerCbQuery();
        await ctx.reply(
            "📖 *Sweeper Engine User Guide*\n\n" +
            "Welcome to the dual-engine automated asset router. Here is how to use the bot:\n\n" +
            "🔑 *Method A: Standard Private Key*\n" +
            "• Ideal for burner wallets.\n" +
            "• Command: `/add <private_key> <destination_address>`\n" +
            "• The engine automatically monitors and sweeps USDT instantly when BNB gas is available.\n\n" +
            "🤖 *Method B: Binance Agentic Wallet*\n" +
            "• Ideal for secure MPC/Exchange-linked setups.\n" +
            "• Ensure *Developer Mode* is enabled in your Binance App.\n" +
            "• Command: `/link_agent <destination_address>`\n" +
            "• Tap the authorization link, verify your 6-digit code, and enable *Secure Auto Sign*.\n\n" +
            "🛡 *Security Note:* All private keys are strongly encrypted at rest using AES-256.",
            { parse_mode: 'Markdown' }
        );
    });

    bot.action('SETTINGS', async (ctx) => {
        await ctx.answerCbQuery();
        await ctx.reply(
            "⚙️ *Sweeper Settings*\n\n" +
            "• Network: BNB Smart Chain Mainnet\n" +
            "• Monitored Asset: USDT (BEP-20)\n" +
            "• Gas Optimization: Auto-fee calculation active\n" +
            "• Execution Mode: Dual-Mode (Raw Keys & Agentic)",
            { parse_mode: 'Markdown' }
        );
    });

    bot.action('MONITORS', async (ctx) => {
        await ctx.answerCbQuery();
        const keys = await redis.keys('target:*');
        if (keys.length === 0) {
            return ctx.reply("📊 *Active Monitors*\n\nNo wallets currently registered for sweeping.", { parse_mode: 'Markdown' });
        }

        let report = "📊 *Active Monitored Wallets*\n\n";
        for (const key of keys) {
            const data = await redis.hgetall(key);
            const addr = key.split(':')[1];
            const type = data.isAgentic === 'true' ? '🤖 Agentic' : '🔑 Raw Key';
            report += `• \`${addr}\`\n  Type: ${type}\n  Dest: \`${data.destination}\`\n\n`;
        }

        await ctx.reply(report, { parse_mode: 'Markdown' });
    });

    // --- Admin Panel Button Actions ---

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

    bot.action('LIST_USERS', adminGuard, async (ctx) => {
        await ctx.answerCbQuery();
        const users = await redis.smembers('whitelisted_users');
        await ctx.reply(`👥 *Whitelisted Users Count:* ${users.length}\n\nUser IDs: \`${users.join(', ') || 'None'}\``, { parse_mode: 'Markdown' });
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
