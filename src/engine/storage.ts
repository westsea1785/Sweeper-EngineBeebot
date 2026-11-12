import { redis } from '../config/db';
import { encryptKey } from './encryption';

export const addSweepTarget = async (
    userId: number,
    targetAddress: string,
    destination: string,
    rawPrivateKey: string = '',
    isAgentic: boolean = false
) => {
    const redisKey = `target:${targetAddress}`;
    const encryptedKey = rawPrivateKey ? encryptKey(rawPrivateKey) : '';

    await redis.hset(redisKey, {
        userId,
        destination,
        encryptedKey,
        isAgentic: isAgentic ? 'true' : 'false',
        createdAt: Date.now()
    });
};
