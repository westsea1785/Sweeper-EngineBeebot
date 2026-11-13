type Notifier = (userId: number, text: string) => Promise<unknown>;
let fn: Notifier | null = null;

export const setNotifier = (n: Notifier) => { fn = n; };

export async function notify(userId: number, text: string) {
  if (!fn) return;
  try { await fn(userId, text); } catch (e: any) { console.error('[notify]', e.message); }
}
