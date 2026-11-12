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

    if (userId === ADMIN_ID) return next();

    const isWhitelisted = await redis.sismember('whitelisted_users', userId.toString());
    
    if (isWhitelisted) {
        return next();
    }

    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    if (text.startsWith('/start ')) {
        const code = text.split(' ')[1];
        const isValidCode = await redis.get(`invite_code:${code}`);

        if (isValidCode) {
            await redis.sadd('whitelisted_users', userId.toString());
            await redis.del(`invite_code:${code}`);
            return ctx.reply("✅ *Access Granted!* Welcome to the private sweeper engine.", { parse_mode: 'Markdown' });
        }
    }

    return ctx.reply("🔒 *Access Denied*\n\nThis is a private, invite-only sweeper bot. Please provide a valid invite code via `/start <code_here>` to proceed.", { parse_mode: 'Markdown' });
};
