import crypto from 'node:crypto';
import { db, redis } from '../config/db';
import { encrypt, decrypt } from './encryption';

export interface Target {
  id: number;
  userId: number;
  target: `0x${string}`;
  destination: `0x${string}`;
  puller: `0x${string}` | null;
  pullerKey: `0x${string}` | null;
  isAgentic: boolean;
  instanceId: string | null;
  allowanceOk: boolean;
}

const map = (r: any): Target => ({
  id: r.id,
  userId: Number(r.user_id),
  target: r.target_address,
  destination: r.destination_address,
  puller: r.puller_address,
  pullerKey: r.encrypted_puller_key ? (decrypt(r.encrypted_puller_key) as `0x${string}`) : null,
  isAgentic: r.is_agentic,
  instanceId: r.baw_instance_id,
  allowanceOk: r.allowance_ok,
});

export async function upsertTarget(o: {
  userId: number; target: string; destination: string;
  puller?: string; pullerKey?: string; isAgentic: boolean; instanceId?: string;
}) {
  await db.query(
    `INSERT INTO sweep_targets
       (user_id, target_address, destination_address, puller_address,
        encrypted_puller_key, is_agentic, baw_instance_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (user_id, target_address) DO UPDATE SET
       destination_address = EXCLUDED.destination_address,
       puller_address = COALESCE(EXCLUDED.puller_address, sweep_targets.puller_address),
       encrypted_puller_key = COALESCE(EXCLUDED.encrypted_puller_key, sweep_targets.encrypted_puller_key),
       baw_instance_id = COALESCE(EXCLUDED.baw_instance_id, sweep_targets.baw_instance_id),
       is_active = true`,
    [o.userId, o.target.toLowerCase(), o.destination.toLowerCase(),
     o.puller?.toLowerCase() ?? null,
     o.pullerKey ? encrypt(o.pullerKey) : null,
     o.isAgentic, o.instanceId ?? null],
  );
  await redis.del('targets:ver');
}

export async function deactivate(userId: number, target: string) {
  await db.query(
    `UPDATE sweep_targets SET is_active = false WHERE user_id = $1 AND target_address = $2`,
    [userId, target.toLowerCase()],
  );
  await redis.del('targets:ver');
}

export async function listActive(userId?: number): Promise<Target[]> {
  const { rows } = userId
    ? await db.query(`SELECT * FROM sweep_targets WHERE is_active AND user_id = $1 ORDER BY created_at`, [userId])
    : await db.query(`SELECT * FROM sweep_targets WHERE is_active ORDER BY created_at`);
  return rows.map(map);
}

export async function setAllowanceOk(target: string, ok: boolean) {
  await db.query(`UPDATE sweep_targets SET allowance_ok = $1 WHERE target_address = $2`, [ok, target.toLowerCase()]);
}

export function newPuller(): { address: `0x${string}`; key: `0x${string}` } {
  const key = ('0x' + crypto.randomBytes(32).toString('hex')) as `0x${string}`;
  // address derived by caller via viem
  return { address: '0x' as `0x${string}`, key };
}
