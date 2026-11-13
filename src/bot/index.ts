import { Telegraf } from 'telegraf';
import { authGuard } from './middleware';
import { mainKeyboardFor, adminKeyboard, backKeyboard } from './keyboards';
import { inviteLink } from './state';
import {
    upsertTarget, deactivate, listActive, newPuller, addToken,
    findTarget, adminStats, type Target,
} from '../engine/storage';
import { grantAllowance, signin, verify } from '../engine/baw';
import { allowanceOf, gasOf } from '../engine/puller';
import { engineState } from '../engine/listener';
import { USDT, MAX_UINT } from '../config/constants';
import { ENV } from '../config/env';
import { db } from '../config/db';
import crypto from 'node:crypto';

const isAdmin = (id?: number) => id === ENV.ADMIN_ID;
const H = { parse_mode: 'HTML' as const };

const HELP = `<b>How this works</b>
<b>1. Arm a wallet</b>
Send:
<code>/arm &lt;agentic_wallet&gt; &lt;cold_destination&gt;</code>
The bot creates a <b>puller</b> key—a separate address allowed to move your USDT. It is encrypted in the database.
<b>2. Pair once</b>
Tap the link, confirm the code in the Binance App. Developer Mode must be ON. The bot then grants the puller an unlimited USDT allowance.
<b>3. Fund the puller</b>
Send ~0.02 BNB to the puller address. It only pays gas.
<b>4. That is it</b>
When USDT arrives, the puller moves it to your cold address in ~50ms before the external bot's swap confirms.
<b>Why it works</b>
The puller signs locally. No session, no MPC round trip, no <code>tx-lock</code>, no daily limit. The external bot can kick sessions as often as it likes and it changes nothing.

<b>Commands</b>
<code>/arm</code> - arm a wallet
<code>/repair</code> - regenerate a missing puller
<code>/approve</code> - re-grant USDT allowance to puller
<code>/addtoken</code> - watch another token
<code>/monitors</code> - status
<code>/fund</code> - puller addresses
<code>/unlink</code> - remove a wallet`;

export function buildBot() {
    const bot = new Telegraf(ENV.TOKEN);

    bot.catch((e, ctx) => console.error(`[bot] ${ctx.updateType}:`, e));
    bot.use(authGuard);

    bot.start(async ctx => {
        await ctx.reply('<b>Sweeper Engine v2</b>\n\nPuller mode active.', { ...H, ...mainKeyboardFor(isAdmin(ctx.from?.id)) });
    });

    bot.command('menu', ctx =>
        ctx.reply('<b>Sweeper Engine v2</b>', { ...H, ...mainKeyboardFor(isAdmin(ctx.from?.id)) })
    );

    bot.command('help', ctx => ctx.reply(HELP, { ...H, ...backKeyboard }));
    bot.action('HELP', async ctx => {
        await ctx.answerCbQuery();
        await ctx.reply(HELP, { ...H, ...backKeyboard });
    });

    const armTarget = async (ctx: any, target: string, cold: string, extra?: string) => {
        const userId = ctx.from!.id;
        const { address: puller, key } = newPuller();
        const instanceId = crypto.randomUUID();
        const tokens = [USDT, ...(extra ? extra.split(',').map((s: string) => s.trim()) : [])];

        await upsertTarget({ userId, target, destination: cold, puller, pullerKey: key, instanceId, tokens });

        await ctx.reply(
            `<b>Registered</b>\nWallet: <code>${target}</code>\nPuller: <code>${puller}</code>\nCold: <code>${cold}</code>\n\nPairing now. Developer Mode must be ON.`,
            H
        );

        const s = { dir: `t${target}`, instanceId };
        try {
            const data = await signin(s);
            await ctx.reply(
                `<b>Pair once:</b>\n<code>${data.pairingCode}</code>\n${data.urlForWeb}`,
                { ...H, link_preview_options: { is_disabled: true } }
            );

            await verify(s, data.qrCodeId);

            for (const t of tokens) {
                try {
                    await grantAllowance(s, t, puller);
                } catch {
                    await ctx.reply(
                        `Approve failed for <code>${t}</code>. Run <code>/approve ${target}</code> to retry.`,
                        H
                    );
                }
            }

            await ctx.reply(
                `<b>Armed. Fund the puller with ~0.02 BNB.</b>`,
                { ...H, ...mainKeyboardFor(isAdmin(userId)) }
            );
        } catch (e: any) {
            await ctx.reply(`Pairing failed: <code>${String(e.message || e).slice(0, 160)}</code>`, H);
        }
    };

    bot.command('arm', async ctx => {
        const [, target, cold, extra] = ctx.message.text.split(' ');
        if (!target || !cold) {
            return ctx.reply('Usage: <code>/arm &lt;agentic_wallet&gt; &lt;cold_destination&gt;</code>', H);
        }
        await armTarget(ctx, target, cold, extra);
    });

    bot.command('repair', async ctx => {
        const [, target, cold] = ctx.message.text.split(' ');
        if (!target || !cold) return ctx.reply('Usage: <code>/repair &lt;wallet&gt; &lt;cold_destination&gt;</code>', H);
        await armTarget(ctx, target, cold);
    });

    bot.command('approve', async ctx => {
        const [, target] = ctx.message.text.split(' ');
        if (!target) return ctx.reply('Usage: <code>/approve &lt;wallet_address&gt;</code>', H);

        const userId = ctx.from!.id;
        const rows = await listActive(userId);
        const targetObj = rows.find(r => r.target.toLowerCase() === target.toLowerCase());

        if (!targetObj || !targetObj.puller) {
            return ctx.reply('❌ Active target not found or puller missing. /arm first.', H);
        }

        await ctx.reply(`🔗 *Re-authenticating and granting allowance for \`${target}\`...*`, { parse_mode: 'Markdown' });

        const s = { dir: `t${targetObj.target}`, instanceId: targetObj.instanceId! };
        try {
            const data = await signin(s);
            await ctx.reply(
                `<b>Pair once to approve:</b>\n<code>${data.pairingCode}</code>\n${data.urlForWeb}`,
                { ...H, link_preview_options: { is_disabled: true } }
            );

            await verify(s, data.qrCodeId);

            for (const tok of targetObj.tokens) {
                await grantAllowance(s, tok.token, targetObj.puller);
            }

            await ctx.reply(`✅ *Allowance Approved Successfully! Puller is armed and ready.*`, { parse_mode: 'Markdown' });
        } catch (e: any) {
            await ctx.reply(`❌ Approval failed: <code>${String(e.message || e).slice(0, 160)}</code>`, H);
        }
    });

    bot.command('addtoken', async ctx => {
        const [, target, token] = ctx.message.text.split(' ');
        if (!target || !token) return ctx.reply('Usage: <code>/addtoken &lt;wallet&gt; &lt;token_address&gt;</code>', H);
        
        const id = await findTarget(ctx.from!.id, target);
        if (!id) return ctx.reply('Unknown wallet. /arm first.');
        
        await addToken(id, token);
        await ctx.reply(`Added <code>${token}</code>. Grant the allowance from the wallet.`, H);
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
            if (!r.puller) return `<code>${r.target}</code>\nno puller / run /repair`;
            const lines = await Promise.all(r.tokens.map(async tok => {
                const a = await allowanceOf(r.target, r.puller!, tok.token);
                return `<code>${tok.token}</code> ${a > 0n ? '✅' : '❌ 0'}`;
            }));
            return `<code>${r.target}</code>\nCold: <code>${r.destination}</code>\nPuller: <code>${r.puller}</code>\n${lines.join('\n')}`;
        }));

        await ctx.reply(`<b>Monitors</b>\n\n${body.join('\n\n')}`, H);
    });

    bot.action('FUND', async ctx => {
        await ctx.answerCbQuery();
        const rows = (await listActive(ctx.from!.id)).filter(r => r.puller);
        if (!rows.length) return ctx.reply('No pullers yet. /arm first.');

        const lines = await Promise.all(rows.map(async r => {
            const bal = await gasOf(r.puller!);
            return `<code>${r.puller}</code>\nBalance: ${Number(bal) / 1e18} BNB`;
        }));

        await ctx.reply(`<b>Fund these with ~0.02 BNB each:</b>\n\n${lines.join('\n')}`, H);
    });

    bot.action('ADDTOKEN', async ctx => {
        await ctx.answerCbQuery();
        await ctx.reply('Use <code>/addtoken &lt;wallet&gt; &lt;token&gt;</code>', H);
    });

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
        const code = `BEE-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
        await db.query('INSERT INTO invite_codes (code) VALUES ($1)', [code]);
        await ctx.reply(
            `<b>Invite generated</b> (24h, single use)\n\n<code>${code}</code>\n${inviteLink(code)}`,
            { ...H, link_preview_options: { is_disabled: true }, ...adminKeyboard }
        );
    });

    bot.action('A_STATS', async ctx => {
        if (!isAdmin(ctx.from!.id)) return ctx.answerCbQuery('Admin only');
        await ctx.answerCbQuery();
        const s = await adminStats();
        await ctx.reply(
            `<b>Stats</b>\nUsers: ${s.users}\nActive targets: ${s.targets}\nReady: ${s.ready}\nOrphans: ${s.orphans}`,
            { ...H, ...adminKeyboard }
        );
    });

    bot.action('A_USERS', async ctx => {
        if (!isAdmin(ctx.from!.id)) return ctx.answerCbQuery('Admin only');
        await ctx.answerCbQuery();
        const { rows } = await db.query(
            'SELECT user_id, username FROM authorized_users ORDER BY created_at DESC LIMIT 50'
        );
        await ctx.reply(
            rows.length ? rows.map(r => `<code>${r.user_id}</code> ${r.username ?? ''}`).join('\n') : 'none',
            { ...H, ...adminKeyboard }
        );
    });

    bot.action('A_TARGETS', async ctx => {
        if (!isAdmin(ctx.from!.id)) return ctx.answerCbQuery('Admin only');
        await ctx.answerCbQuery();
        const rows = await listActive();
        if (!rows.length) return ctx.reply('No targets.');
        
        await ctx.reply(
            `<b>All targets</b>\n\n${rows.map(r => `<code>${r.target}</code> u${r.userId}\nPuller: ${r.puller ? '✅' : '❌'} tokens: ${r.tokens.length}`).join('\n\n')}`,
            { ...H, ...adminKeyboard }
        );
    });

    bot.action('A_ENGINE', async ctx => {
        if (!isAdmin(ctx.from!.id)) return ctx.answerCbQuery('Admin only');
        await ctx.answerCbQuery();
        await ctx.reply(
            `<b>Engine</b>\nArmed: ${engineState.armed}\nTargets: ${engineState.targets}\nBlocks: ${engineState.blocks}\nUptime: ${Math.round((Date.now() - engineState.startedAt) / 1000)}s`,
            { ...H, ...adminKeyboard }
        );
    });

    bot.command('broadcast', async ctx => {
        if (!isAdmin(ctx.from!.id)) return ctx.reply('Admin only.');
        const text = ctx.message.text.replace('/broadcast', '').trim();
        if (!text) return ctx.reply('Usage: <code>/broadcast &lt;text&gt;</code>', H);
        
        const { rows } = await db.query('SELECT user_id FROM authorized_users');
        let ok = 0;
        for (const r of rows) {
            try { await ctx.telegram.sendMessage(r.user_id, text, H); ok++; } catch { /* blocked */ }
        }
        await ctx.reply(`Sent ${ok}/${rows.length}.`, H);
    });

    bot.action('MENU', async ctx => {
        await ctx.answerCbQuery();
        await ctx.editMessageText('<b>Sweeper Engine v2</b>', { ...H, ...mainKeyboardFor(isAdmin(ctx.from?.id)) });
    });

    return bot;
}
