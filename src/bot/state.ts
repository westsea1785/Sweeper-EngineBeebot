let username = '';
export const setBotUsername = (u: string) => { username = u; };
export const getBotUsername = () => username;
export const inviteLink = (code: string) =>
  `https://t.me/${username || 'Sweeper_Beebot'}?start=${code}`;
