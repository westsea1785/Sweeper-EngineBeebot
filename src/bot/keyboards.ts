import { Markup } from 'telegraf';

export const mainDashboardKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('⚡️ Add Target Wallet', 'ADD_TARGET')],
    [Markup.button.callback('📖 User Guide', 'USER_GUIDE')],
    [Markup.button.callback('⚙️ Sweeper Settings', 'SETTINGS'), Markup.button.callback('📊 Active Monitors', 'MONITORS')]
]);

export const adminPanelKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🔑 Generate Invite Code', 'GEN_INVITE')],
    [Markup.button.callback('👥 List Active Users', 'LIST_USERS')],
    [Markup.button.callback('🔙 Back to Main', 'MAIN_MENU')]
]);
