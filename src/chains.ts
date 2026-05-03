import type { Chain } from 'viem';
import { arbitrum, arbitrumNova, arbitrumSepolia } from 'viem/chains';

/**
 * Default chains supported by the BitShard connector.
 */
export const DEFAULT_CHAINS: readonly Chain[] = [
    arbitrum,
    arbitrumNova,
    arbitrumSepolia
] as const;

export const DEFAULT_CHAIN_IDS: readonly number[] = DEFAULT_CHAINS.map((c) => c.id);

export function findChain(chains: readonly Chain[], chainId: number): Chain | undefined {
    return chains.find((c) => c.id === chainId);
}
