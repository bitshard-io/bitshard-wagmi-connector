import { createConnector } from '@wagmi/core';
import { getAddress, type Address } from 'viem';

import { DEFAULT_CHAINS } from './chains.js';
import { BitShardProvider } from './provider.js';
import type { BitShardConnectorParameters } from './types.js';

const DEFAULT_POPUP_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_STORAGE_PREFIX = 'bitshard.wagmi';

export const BITSHARD_CONNECTOR_ID = 'bitshard' as const;

/**
 * Wagmi connector for the BitShard MPC wallet. Opens a hosted popup to the
 * BitShard wallet app for auth and signature approval.
 *
 * @example
 * ```ts
 * import { createConfig, http } from '@wagmi/core';
 * import { arbitrumSepolia } from '@wagmi/core/chains';
 * import { bitshard } from '@bitshard.io/bitshard-wagmi-connector';
 *
 * export const config = createConfig({
 *   chains: [arbitrumSepolia],
 *   connectors: [bitshard({ appUrl: 'https://wallet.bitshard.io' })],
 *   transports: { [arbitrumSepolia.id]: http() }
 * });
 * ```
 */
export function bitshard(parameters: BitShardConnectorParameters) {
    if (!parameters?.appUrl) {
        throw new Error('bitshard() connector requires an `appUrl` parameter');
    }

    type Properties = {
        getProvider(): Promise<BitShardProvider>;
    };

    let providerInstance: BitShardProvider | null = null;

    return createConnector<BitShardProvider, Properties>((config) => {
        const chains = (parameters.chains ?? config.chains ?? DEFAULT_CHAINS) as readonly any[];

        function ensureProvider(): BitShardProvider {
            if (!providerInstance) {
                providerInstance = new BitShardProvider({
                    appUrl: parameters.appUrl,
                    chains,
                    storagePrefix: parameters.storagePrefix ?? DEFAULT_STORAGE_PREFIX,
                    popupTimeoutMs: parameters.popupTimeoutMs ?? DEFAULT_POPUP_TIMEOUT_MS
                });
            }
            return providerInstance;
        }

        function attachEvents(provider: BitShardProvider) {
            provider.on('accountsChanged', (accounts: string[]) => onAccountsChanged(accounts));
            provider.on('chainChanged', (chainIdHex: string) => onChainChanged(chainIdHex));
            provider.on('disconnect', () => onDisconnect());
        }

        const onAccountsChanged = (accounts: string[]) => {
            if (!accounts || accounts.length === 0) {
                config.emitter.emit('disconnect');
                return;
            }
            const mapped = accounts.map((a) => getAddress(a));
            config.emitter.emit('change', { accounts: mapped as readonly Address[] });
        };

        const onChainChanged = (chainIdHex: string) => {
            const chainId = typeof chainIdHex === 'string' ? parseInt(chainIdHex, 16) : Number(chainIdHex);
            config.emitter.emit('change', { chainId });
        };

        const onDisconnect = () => {
            config.emitter.emit('disconnect');
        };

        return {
            id: BITSHARD_CONNECTOR_ID,
            name: 'BitShard',
            type: 'bitshard',

            async connect(parameters?: {
                chainId?: number;
                isReconnecting?: boolean;
                withCapabilities?: boolean;
            }) {
                const provider = ensureProvider();
                attachEvents(provider);

                const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
                const addresses = accounts.map((a) => getAddress(a) as Address) as readonly Address[];

                let resolvedChainId = provider.currentChainId();
                if (parameters?.chainId && parameters.chainId !== resolvedChainId) {
                    try {
                        await provider.request({
                            method: 'wallet_switchEthereumChain',
                            params: [{ chainId: `0x${parameters.chainId.toString(16)}` }]
                        });
                        resolvedChainId = parameters.chainId;
                    } catch (err) {
                        console.warn('[bitshard connector] switchChain during connect failed:', err);
                    }
                }

                if (parameters?.withCapabilities) {
                    const withCaps = addresses.map((address) => ({ address, capabilities: {} as Record<string, unknown> }));
                    return { accounts: withCaps, chainId: resolvedChainId } as any;
                }
                return { accounts: addresses, chainId: resolvedChainId } as any;
            },

            async disconnect() {
                const provider = ensureProvider();
                await provider.disconnect();
            },

            async getAccounts() {
                const provider = ensureProvider();
                const session = provider.getSession();
                return session ? [getAddress(session.address) as Address] : [];
            },

            async getChainId() {
                const provider = ensureProvider();
                return provider.currentChainId();
            },

            async getProvider() {
                return ensureProvider();
            },

            async isAuthorized() {
                const provider = ensureProvider();
                return provider.getSession() !== null;
            },

            async switchChain({ chainId }: { chainId: number }) {
                const provider = ensureProvider();
                await provider.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: `0x${chainId.toString(16)}` }]
                });
                const chain = (chains as readonly any[]).find((c: any) => c.id === chainId);
                if (!chain) throw new Error(`Unsupported chain: ${chainId}`);
                return chain;
            },

            onAccountsChanged,
            onChainChanged,
            onDisconnect
        };
    });
}
