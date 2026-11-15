import { ENV } from '../config/env';

/**
 * Returns the active verified router contract address from environment variables.
 * Used by legacy allowance checks and health monitoring components.
 */
export function getRouter(): string | null {
    return process.env.ROUTER_CONTRACT_ADDRESS || null;
}
