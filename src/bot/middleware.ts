import { Context } from 'telegraf';
import { redis } from '../config/db';

const ADMIN_ID = Number(process.env.ADMIN_TELEGRAM_ID || 0);

export const adminGuard = async (ctx: Context, next: () => Promise<void>) => {
    const userId = ctx.from?.id;
    if (userId !== ADMIN_ID) {
        return ctx.reply("⛔️ Unauthorized. This command is restricted to the administrator.");
    }
    return next();
};

export const inviteOnlyGuard = async (ctx: Context, next: () => Promise<void>) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    // Admin bypasses invite check automatically
    if (userId === ADMIN_ID) return next();

    // Check if user is already whitelisted
    const isWhitelisted = await redis.sismember('whitelisted_users', userId.toString());
    if (isWhitelisted) {
        return next();
    }

    const text = ctx.message && 'text' in ctx.message ? ctx.message.text.trim() : '';
    let codeToVerify = '';

    // Case 1: User sent /start <CODE>
    if (text.startsWith('/start ')) {
        codeToVerify = text.split(' ')[1];
    } 
    // Case 2: User just typed or pasted the code directly (e.g. BEE-XXXXXX)
    else if (text.startsWith('BEE-')) {
        codeToVerify = text;
    }

    if (codeToVerify) {
        const isValidCode = await redis.get(`invite_code:${codeToVerify}`);

        if (isValidCode) {
            await redis.sadd('whitelisted_users', userId.toString());
            await redis.del(`invite_code:${codeToVerify}`); // Burn code after use
            return ctx.reply("✅ *Access Granted!* Welcome to the private sweeper engine. Type /start to open the dashboard.", { parse_mode: 'Markdown' });
        } else {
            return ctx.reply("❌ *Invalid or Expired Code*\n\nThis invite code is invalid or has already been used.", { parse_mode: 'Markdown' });
        }
    }

    return ctx.reply("🔒 *Access Denied*\n\nThis is a private, invite-only sweeper bot. Please send a valid invite code or use your invite link to proceed.", { parse_mode: 'Markdown' });
};
