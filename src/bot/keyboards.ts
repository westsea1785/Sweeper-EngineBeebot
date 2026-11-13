export function mainKeyboardFor(admin: boolean) {
  const rows: any[][] = [
    [{ text: '📡 Monitors', callback_data: 'MONITORS' }],
    [{ text: '⛽ Puller addresses', callback_data: 'FUND' }],
    [{ text: '➕ Add token', callback_data: 'ADDTOKEN' }],
    [{ text: '📖 How it works', callback_data: 'HELP' }],
  ];
  if (admin) rows.push([{ text: '🛠 Admin Panel', callback_data: 'A_PANEL' }]);
  return { reply_markup: { inline_keyboard: rows } };
}

export const adminKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '🎟 Generate Invite', callback_data: 'A_INVITE_GEN' }],
      [{ text: '📊 Stats', callback_data: 'A_STATS' }],
      [{ text: '👥 Users', callback_data: 'A_USERS' }, { text: '📡 Targets', callback_data: 'A_TARGETS' }],
      [{ text: '🩺 Engine', callback_data: 'A_ENGINE' }],
      [{ text: '⬅️ Back', callback_data: 'MENU' }],
    ],
  },
};

export const backKeyboard = {
  reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'MENU' }]] },
};
