import { db, redis } from '../config/db';
import { encryptKey } from './encryption';

export const addSweepTarget = async (
    userId: number, 
    targetAddress: string, 
    destinationAddress: string, 
    privateKey: string
) => {
    const encryptedKey = encryptKey(privateKey);
    const normalizedTarget = targetAddress.toLowerCase();

    // 1. Save permanently in Postgres
    await db.query(
        `INSERT INTO sweep_targets (user_id, target_address, destination_address, encrypted_private_key) 
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (target_address) DO UPDATE 
         SET destination_address = $3, encrypted_private_key = $4, is_active = true`,
        [userId, normalizedTarget, destinationAddress, encryptedKey]
    );

    // 2. Load into Redis for ultra-fast lookup by the execution engine
    await redis.hset(`target:${normalizedTarget}`, {
        userId: userId.toString(),
        destination: destinationAddress,
        encryptedKey: encryptedKey
    });

    return true;
};

// The execution engine will call this function upon seeing a transfer
export const getTargetConfig = async (targetAddress: string) => {
    return await redis.hgetall(`target:${targetAddress.toLowerCase()}`);
};
