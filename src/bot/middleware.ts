import { Context } from 'telegraf';

// In production, this will be fetched from Redis/Postgres. 
// For Phase 1, we use environment variables for the Master Admin.
const ADMIN_ID = Number(process.env.ADMIN_TELEGRAM_ID);

// In-memory cache for authorized users (updated via Admin panel)
export const authorizedUsers = new Set<number>([ADMIN_ID]);

export const inviteOnlyGuard = async (ctx: Context, next: () => Promise<void>) => {
    const userId = ctx.from?.id;
    
    if (!userId) return;

    if (authorizedUsers.has(userId)) {
        await next(); // Authorized, proceed to route
    } else {
        await ctx.reply("⛔️ Access Denied. This engine is invite-only.");
    }
};

export const adminGuard = async (ctx: Context, next: () => Promise<void>) => {
    const userId = ctx.from?.id;
    
    if (userId === ADMIN_ID) {
        await next();
    } else {
        await ctx.reply("⚠️ Admin privileges required.");
    }
};
