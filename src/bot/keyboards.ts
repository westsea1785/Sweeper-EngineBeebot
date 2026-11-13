export const mainKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '📡 Monitors', callback_data: 'MONITORS' }],
      [{ text: '⛽ Puller addresses', callback_data: 'FUND' }],
      [{ text: '➕ Add token', callback_data: 'ADDTOKEN' }],
      [{ text: '📖 How it works', callback_data: 'HELP' }],
    ],
  },
};

export const adminKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '📊 Stats', callback_data: 'A_STATS' }],
      [{ text: '🎟 Invites', callback_data: 'A_INVITES' }, { text: '👥 Users', callback_data: 'A_USERS' }],
      [{ text: '📡 All targets', callback_data: 'A_TARGETS' }],
      [{ text: '🩺 Engine', callback_data: 'A_ENGINE' }],
      [{ text: '⬅️ Back', callback_data: 'MENU' }],
    ],
  },
};

export const backKeyboard = {
  reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'MENU' }]] },
};
