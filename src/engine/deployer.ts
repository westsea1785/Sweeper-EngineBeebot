import { createWalletClient, createPublicClient, http, fallback } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';
import { ENV } from '../config/env';
import { notify } from './notify';

const ROUTER_BYTECODE = "0x608060405234801561001057600080fd5b5060405161023a38038061023a833981016040528080519060200190919050505b600080546001600160a060020a031916336001600160a060020a03161790555b6101af8061005c6000396000f3fe6080604052348015600f57600080fd5b506004361060285760003560e01c80632a689b6514602d575b600080fd5b60243610603f5760003560e01c8063f2fde38b1460b5575b600080fd5b348015604b57600080fd5b5060f66004803603810190610061919061013d5650565b34801560c157600080fd5b50601060048036038101906100d291906101855650565b600080546001600160a060020a031633146101135760405162461bcd60e51b815260040161010a90610214565b60405180910390fd5b806001600160a060020a0316600080546001600160a060020a0319166001600160a060020a039092169190911790555b50565b60008060c484860361015157600080fd5b5051949392919050565b60008060c482840361019657600080fd5b5051929392915050565b60208152600081518083038185019061022091906101855650565b60208082526026908201527f4e6f7420617574686f72697a656400000000000000000000000000000000000060208201526040019056";

export async function ensureRouterDeployed(): Promise<string | null> {
    if (ENV.ROUTER_CONTRACT_ADDRESS) {
        return ENV.ROUTER_CONTRACT_ADDRESS;
    }

    const deployerKey = process.env.DEPLOYER_KEY as `0x${string}` | undefined;
    if (!deployerKey) {
        console.log("[Deployer] No DEPLOYER_KEY found in process.env. Skipping auto-deployment.");
        return null;
    }

    try {
        console.log("[Deployer] Auto-deploying TokenRouter contract on BSC...");
        const account = privateKeyToAccount(deployerKey);
        const transport = fallback(ENV.HTTP_URLS.map(u => http(u)));
        
        const publicClient = createPublicClient({ chain: bsc, transport });
        const walletClient = createWalletClient({ account, chain: bsc, transport });

        // Explicitly get gas price to prevent EIP-1559 overflow bugs on BSC
        const price = await publicClient.getGasPrice();
        const gasPrice = (price * 120n) / 100n;

        const hash = await walletClient.deployContract({
            abi: [],
            bytecode: ROUTER_BYTECODE as `0x${string}`,
            gas: 300_000n,
            gasPrice,
        });

        console.log(`[Deployer] Tx broadcasted: ${hash}, waiting for confirmation...`);
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        
        const contractAddress = receipt.contractAddress;
        console.log(`✅ [Deployer] SUCCESS! Router Contract Address: ${contractAddress}`);

        if (ENV.ADMIN_ID && contractAddress) {
            await notify(
                ENV.ADMIN_ID,
                `🚀 <b>TokenRouter Deployed Successfully!</b>\n\n` +
                `<b>Contract Address:</b> <code>${contractAddress}</code>\n\n` +
                `<i>Please add this address as <code>ROUTER_CONTRACT_ADDRESS</code> in your Railway variables.</i>`
            );
        }

        return contractAddress;
    } catch (e: any) {
        console.error("[Deployer Error] Failed to auto-deploy router:", e.message);
        return null;
    }
}
