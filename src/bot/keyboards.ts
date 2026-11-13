export const mainKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '📡 Monitors', callback_data: 'MONITORS' }],
      [{ text: '➕ New Puller', callback_data: 'NEW_PULLER' }],
      [{ text: '🔄 Status', callback_data: 'STATUS' }],
    ],
  },
};

export const adminKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '🎟 Invite', callback_data: 'INVITE' }],
      [{ text: '👥 Users', callback_data: 'USERS' }],
      [{ text: '⬅️ Back', callback_data: 'MENU' }],
    ],
  },
};
