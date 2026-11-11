import { Pool } from 'pg';
import Redis from 'ioredis';
import * as dotenv from 'dotenv';

dotenv.config();

if (!process.env.DATABASE_URL || !process.env.REDIS_URL) {
    console.warn("⚠️ DATABASE_URL or REDIS_URL missing. Storage will fail.");
}

export const db = new Pool({
    connectionString: process.env.DATABASE_URL,
});

export const redis = new Redis(process.env.REDIS_URL || '');

export const initializeDatabase = async () => {
    const client = await db.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS sweep_targets (
                id SERIAL PRIMARY KEY,
                user_id BIGINT NOT NULL,
                target_address VARCHAR(42) NOT NULL UNIQUE,
                destination_address VARCHAR(42) NOT NULL,
                encrypted_private_key TEXT NOT NULL,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("✅ PostgreSQL Schema Verified");
    } finally {
        client.release();
    }
};
