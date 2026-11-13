import { Pool } from 'pg';
import Redis from 'ioredis';
import { ENV } from './env';

export const db = new Pool({
  connectionString: ENV.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});
db.on('error', e => console.error('[pg]', e.message));

export const redis = new Redis(ENV.REDIS_URL, { maxRetriesPerRequest: 3 });
redis.on('error', e => console.error('[redis]', e.message));

export async function migrate() {
  const c = await db.connect();
  try {
    await c.query(`
      CREATE TABLE IF NOT EXISTS authorized_users (
        user_id BIGINT PRIMARY KEY,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS invite_codes (
        code TEXT PRIMARY KEY,
        used_by BIGINT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS sweep_targets (
        id                   SERIAL PRIMARY KEY,
        user_id              BIGINT NOT NULL,
        target_address       VARCHAR(42) NOT NULL,
        destination_address  VARCHAR(42) NOT NULL,
        puller_address       VARCHAR(42),
        encrypted_puller_key TEXT,
        is_agentic           BOOLEAN NOT NULL DEFAULT false,
        baw_instance_id      TEXT,
        is_active            BOOLEAN NOT NULL DEFAULT true,
        created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (user_id, target_address)
      );
      CREATE TABLE IF NOT EXISTS target_tokens (
        id            SERIAL PRIMARY KEY,
        target_id     INTEGER NOT NULL REFERENCES sweep_targets(id) ON DELETE CASCADE,
        token_address VARCHAR(42) NOT NULL,
        allowance_ok  BOOLEAN NOT NULL DEFAULT false,
        created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (target_id, token_address)
      );
      CREATE INDEX IF NOT EXISTS sweep_targets_active_idx
        ON sweep_targets (is_active) WHERE is_active;
    `);
    console.log('[pg] schema ready');
  } finally { c.release(); }
}
