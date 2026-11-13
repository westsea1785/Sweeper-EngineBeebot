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
        username TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS invite_codes (
        code TEXT PRIMARY KEY,
        used_by BIGINT,
        expires_at TIMESTAMP NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
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
        created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS target_tokens (
        id            SERIAL PRIMARY KEY,
        target_id     INTEGER NOT NULL REFERENCES sweep_targets(id) ON DELETE CASCADE,
        token_address VARCHAR(42) NOT NULL,
        allowance_ok  BOOLEAN NOT NULL DEFAULT false,
        created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (target_id, token_address)
      );
    `);

    // --- upgrade an existing legacy table ---
    await c.query(`
      ALTER TABLE authorized_users ADD COLUMN IF NOT EXISTS username TEXT;
      ALTER TABLE invite_codes ADD COLUMN IF NOT EXISTS expires_at
        TIMESTAMP NOT NULL DEFAULT (NOW() + INTERVAL '24 hours');

      ALTER TABLE sweep_targets ADD COLUMN IF NOT EXISTS puller_address VARCHAR(42);
      ALTER TABLE sweep_targets ADD COLUMN IF NOT EXISTS encrypted_puller_key TEXT;
      ALTER TABLE sweep_targets ADD COLUMN IF NOT EXISTS is_agentic BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE sweep_targets ADD COLUMN IF NOT EXISTS baw_instance_id TEXT;
      ALTER TABLE sweep_targets ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
      ALTER TABLE sweep_targets ALTER COLUMN encrypted_private_key DROP NOT NULL;
    `);

    // drop the legacy single-column unique so multiple users can share a wallet
    await c.query(`
      DO $$
      DECLARE con text;
      BEGIN
        SELECT conname INTO con FROM pg_constraint
         WHERE conrelid = 'sweep_targets'::regclass
           AND contype = 'u'
           AND pg_get_constraintdef(oid) = 'UNIQUE (target_address)';
        IF con IS NOT NULL THEN
          EXECUTE format('ALTER TABLE sweep_targets DROP CONSTRAINT %I', con);
        END IF;
      END $$;
    `);

    await c.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS sweep_targets_user_target_idx
        ON sweep_targets (user_id, target_address);
      CREATE INDEX IF NOT EXISTS sweep_targets_active_idx
        ON sweep_targets (is_active) WHERE is_active;
      CREATE INDEX IF NOT EXISTS target_tokens_target_idx
        ON target_tokens (target_id);
    `);

    console.log('[pg] schema ready');
  } finally { c.release(); }
}
