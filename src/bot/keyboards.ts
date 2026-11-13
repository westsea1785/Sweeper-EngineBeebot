export const mainKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '📡 Monitors', callback_data: 'MONITORS' }],
      [{ text: '⛽ Puller addresses', callback_data: 'FUND' }],
      [{ text: '➕ Add token', callback_data: 'ADDTOKEN' }],
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
