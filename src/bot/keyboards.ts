import { Markup } from 'telegraf';

export const mainDashboardKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('⚡️ Add Target Wallet', 'ADD_TARGET')],
    [Markup.button.callback('⚙️ Sweeper Settings', 'SETTINGS')],
    [Markup.button.callback('📊 Active Monitors', 'VIEW_ACTIVE')]
]);

export const adminPanelKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🎟 Generate Invite Code', 'GEN_INVITE')],
    [Markup.button.callback('👥 Manage Users', 'MANAGE_USERS')]
]);
