import type { Context, Next } from 'telegraf';
import { db } from '../config/db';
import { ENV } from '../config/env';

const CODE_RE = /^BEE-[A-Z0-9]{4,10}$/i;

async function redeem(ctx: Context, id: number, code: string): Promise<boolean> {
  const claim = await db.query(
    `UPDATE invite_codes SET used_by=$1
     WHERE code=$2 AND used_by IS NULL AND expires_at > NOW()
     RETURNING code`,
    [id, code.toUpperCase()],
  );
  if (!claim.rowCount) return false;
  await db.query(
    `INSERT INTO authorized_users (user_id, username) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
    [id, ctx.from?.username ?? null],
  );
  return true;
}

export async function authGuard(ctx: Context, next: Next) {
  const id = ctx.from?.id;
  if (!id) return;
  if (id === ENV.ADMIN_ID) return next();

  const { rows } = await db.query(`SELECT 1 FROM authorized_users WHERE user_id=$1`, [id]);
  if (rows.length) return next();

  const text = ((ctx.message as any)?.text ?? '').trim();
  const payload = (ctx as any).startPayload as string | undefined;
  const code = payload || (CODE_RE.test(text) ? text : undefined);

  if (code) {
    if (await redeem(ctx, id, code)) {
      await ctx.reply('✅ Authorized. Send /help to get started.');
      return;
    }
    await ctx.reply('❌ Invalid or expired invite.');
    return;
  }

  await ctx.reply('🔒 <b>Not authorized</b>\n\nSend your invite code, or open an invite link.',
    { parse_mode: 'HTML' });
}
