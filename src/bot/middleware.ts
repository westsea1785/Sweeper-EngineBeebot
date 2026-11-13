import type { Context, Next } from 'telegraf';
import { db } from '../config/db';
import { ENV } from '../config/env';

export async function authGuard(ctx: Context, next: Next) {
  const id = ctx.from?.id;
  if (!id) return;
  if (id === ENV.ADMIN_ID) return next();

  const { rows } = await db.query(`SELECT 1 FROM authorized_users WHERE user_id = $1`, [id]);
  if (rows.length) return next();

  const text = (ctx.message as any)?.text as string | undefined;
  const code = text?.split(' ')[1] || (ctx as any).startPayload;
  if (code) {
    const claim = await db.query(
      `UPDATE invite_codes SET used_by = $1 WHERE code = $2 AND used_by IS NULL RETURNING code`,
      [id, code.toUpperCase()],
    );
    if (claim.rowCount) {
      await db.query(`INSERT INTO authorized_users (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [id]);
      await ctx.reply('✅ Authorized. Send /menu');
      return;
    }
  }
  await ctx.reply('🔒 Not authorized. Use an invite link.');
}
