import { createPublicClient, http, numberToHex, type Chain, type PublicClient } from 'viem';

import { findChain } from './chains.js';
import { buildPopupUrl, openPopup, openWalletViewer, toOrigin } from './popup.js';
import { clearSession, loadSession, saveSession } from './storage.js';
import type {
    BitShardConnectorParameters,
    BitShardSession,
    BitShardTokensPayload,
    PopupWalletChangedPayload,
    PopupConnectedPayload,
    PopupSignedPayload,
    PopupTokensPayload,
    PopupTxPayload
} from './types.js';

type EventHandler = (...args: any[]) => void;

type EIP1193RequestArgs = { method: string; params?: readonly unknown[] | Record<string, unknown> };

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Minimal EIP-1193 provider backed by the BitShard hosted popup for
 * authorization/signing and a viem public client for read-only calls.
 */
export class BitShardProvider {
    readonly appUrl: string;
    readonly appOrigin: string;
    readonly chains: readonly Chain[];
    readonly storagePrefix: string;
    readonly popupTimeoutMs: number;

    private listeners = new Map<string, Set<EventHandler>>();
    private publicClientCache = new Map<number, PublicClient>();
    private session: BitShardSession | null;

    constructor(parameters: Required<Omit<BitShardConnectorParameters, 'storagePrefix' | 'popupTimeoutMs' | 'chains'>> & {
        chains: readonly Chain[];
        storagePrefix: string;
        popupTimeoutMs: number;
    }) {
        this.appUrl = parameters.appUrl;
        this.appOrigin = toOrigin(parameters.appUrl);
        this.chains = parameters.chains;
        this.storagePrefix = parameters.storagePrefix;
        this.popupTimeoutMs = parameters.popupTimeoutMs;
        this.session = loadSession(this.storagePrefix);
        this.installWalletMessageListener();
    }

    /**
     * Listen for wallet-origin messages that are not tied to a single popup
     * request. Logout disconnects wagmi; walletChanged keeps the dApp account
     * in sync when the user toggles Local/MPC in a read-only wallet popup.
     */
    private installWalletMessageListener(): void {
        if (typeof window === 'undefined') return;
        window.addEventListener('message', (event: MessageEvent) => {
            if (event.origin !== this.appOrigin) return;
            const data = event.data;
            if (!data || typeof data !== 'object') return;
            const type = (data as any).type;

            if (type === 'bitshard:logout') {
                if (!this.session) return;
                this.setSession(null);
                this.emit('disconnect');
                this.emit('accountsChanged', []);
                return;
            }

            if (type === 'bitshard:walletChanged') {
                const payload = data as PopupWalletChangedPayload;
                if (!payload.address || !payload.chainId) return;
                const nextSession: BitShardSession = {
                    address: payload.address,
                    chainId: payload.chainId,
                    walletKind: payload.walletKind,
                    expiresAt: this.session?.expiresAt ?? Date.now() + SESSION_TTL_MS
                };
                this.setSession(nextSession);
                this.emit('accountsChanged', [nextSession.address]);
                this.emit('chainChanged', numberToHex(nextSession.chainId));
                this.emit('bitshard:walletChanged', nextSession);
            }
        });
    }

    on(event: string, handler: EventHandler): void {
        let set = this.listeners.get(event);
        if (!set) {
            set = new Set();
            this.listeners.set(event, set);
        }
        set.add(handler);
    }

    removeListener(event: string, handler: EventHandler): void {
        const set = this.listeners.get(event);
        if (!set) return;
        set.delete(handler);
    }

    emit(event: string, ...args: unknown[]): void {
        const set = this.listeners.get(event);
        if (!set) return;
        for (const handler of Array.from(set)) {
            try {
                handler(...args);
            } catch (err) {
                console.error(`[BitShardProvider] listener for "${event}" threw:`, err);
            }
        }
    }

    getSession(): BitShardSession | null {
        return this.session;
    }

    setSession(session: BitShardSession | null): void {
        this.session = session;
        if (session) saveSession(session, this.storagePrefix);
        else clearSession(this.storagePrefix);
    }

    async request(args: EIP1193RequestArgs): Promise<unknown> {
        const { method } = args;
        const params = (args.params ?? []) as readonly unknown[];

        switch (method) {
            case 'eth_requestAccounts':
                return this.handleConnect();
            case 'eth_accounts':
                return this.session ? [this.session.address] : [];
            case 'eth_chainId':
                return numberToHex(this.currentChainId());
            case 'wallet_switchEthereumChain':
                return this.handleSwitchChain(params);
            case 'personal_sign':
                return this.handleSign('personal_sign', params);
            case 'eth_sign':
                return this.handleSign('eth_sign', params);
            case 'eth_signTypedData_v4':
            case 'eth_signTypedData':
                return this.handleSign(method, params);
            case 'eth_sendTransaction':
                return this.handleSendTransaction(params);
            case 'bitshard_getTokens':
                return this.getTokens(this.parseOptionalChainId(params[0]));
            case 'wallet_addEthereumChain':
                return null;
            case 'wallet_getPermissions':
            case 'wallet_requestPermissions':
                return this.session
                    ? [{ parentCapability: 'eth_accounts', caveats: [{ type: 'restrictReturnedAccounts', value: [this.session.address] }] }]
                    : [];
            default:
                return this.forwardToPublicClient(method, params);
        }
    }

    async disconnect(): Promise<void> {
        this.setSession(null);
        this.emit('disconnect');
        this.emit('accountsChanged', []);
    }

    currentChainId(): number {
        return this.session?.chainId ?? this.chains[0]?.id ?? 421614;
    }

    /**
     * Open the BitShard popup in read-only "view" mode so the user can
     * inspect their wallet (tokens, NFTs, selected wallet kind) on the
     * given chain without authorizing any action. Does not wait for a
     * response from the popup.
     *
     * Typical use from a dApp:
     * ```ts
     * const provider = await config.connectors[0].getProvider();
     * (provider as any).viewWallet(); // uses session chain
     * (provider as any).viewWallet(42161); // override chain
     * ```
     */
    viewWallet(chainId?: number): Window | null {
        const targetChain = chainId ?? this.currentChainId();
        return openWalletViewer({ appUrl: this.appUrl, chainId: targetChain });
    }

    /**
     * Fetch ERC-20 balances for the BitShard wallet selected during connect.
     * The wallet app performs the authenticated backend request and returns
     * only token data to the dApp.
     */
    async getTokens(chainId?: number): Promise<BitShardTokensPayload> {
        this.requireSession();
        const targetChain = chainId ?? this.currentChainId();
        const url = buildPopupUrl(this.appUrl, 'tokens', { chainId: targetChain });
        const result = (await openPopup({ url, appOrigin: this.appOrigin, timeoutMs: this.popupTimeoutMs })) as PopupTokensPayload;
        if (result.type !== 'bitshard:tokens') {
            throw new Error(`Unexpected popup response type: ${result.type}`);
        }
        const { type: _type, ...tokens } = result;
        return tokens;
    }

    private async handleConnect(): Promise<`0x${string}`[]> {
        if (this.session) {
            return [this.session.address];
        }
        const url = buildPopupUrl(this.appUrl, 'connect', {
            chainId: this.currentChainId()
        });
        const result = (await openPopup({ url, appOrigin: this.appOrigin, timeoutMs: this.popupTimeoutMs })) as PopupConnectedPayload;
        if (result.type !== 'bitshard:connected') {
            throw new Error(`Unexpected popup response type: ${result.type}`);
        }
        const expiresAt = result.expiresAt ?? Date.now() + SESSION_TTL_MS;
        const session: BitShardSession = {
            address: result.address,
            chainId: result.chainId,
            walletKind: result.walletKind,
            expiresAt
        };
        this.setSession(session);
        this.emit('connect', { chainId: numberToHex(session.chainId) });
        this.emit('accountsChanged', [session.address]);
        return [session.address];
    }

    private async handleSwitchChain(params: readonly unknown[]): Promise<null> {
        const arg = params[0] as { chainId?: string } | undefined;
        if (!arg?.chainId) throw new Error('wallet_switchEthereumChain: missing chainId');
        const chainId = typeof arg.chainId === 'string' ? parseInt(arg.chainId, 16) : Number(arg.chainId);
        const chain = findChain(this.chains, chainId);
        if (!chain) {
            const err: Error & { code?: number } = new Error(`Unsupported chain: ${chainId}`);
            err.code = 4902;
            throw err;
        }
        if (this.session) {
            this.setSession({ ...this.session, chainId });
        }
        this.emit('chainChanged', numberToHex(chainId));
        return null;
    }

    private async handleSign(method: string, params: readonly unknown[]): Promise<`0x${string}`> {
        this.requireSession();
        const [first, second] = params;
        let message: string;
        let address: string | undefined;

        if (method === 'personal_sign') {
            message = String(first ?? '');
            address = typeof second === 'string' ? second : undefined;
        } else if (method === 'eth_sign') {
            address = typeof first === 'string' ? first : undefined;
            message = String(second ?? '');
        } else {
            address = typeof first === 'string' ? first : undefined;
            const data = second;
            message = typeof data === 'string' ? data : JSON.stringify(data);
        }

        const url = buildPopupUrl(this.appUrl, 'sign', {
            method,
            message,
            address: address ?? this.session?.address,
            chainId: this.currentChainId()
        });
        const result = (await openPopup({ url, appOrigin: this.appOrigin, timeoutMs: this.popupTimeoutMs })) as PopupSignedPayload;
        if (result.type !== 'bitshard:signed') {
            throw new Error(`Unexpected popup response type: ${result.type}`);
        }
        return result.signature;
    }

    private async handleSendTransaction(params: readonly unknown[]): Promise<`0x${string}`> {
        this.requireSession();
        const tx = (params[0] ?? {}) as Record<string, unknown>;
        const url = buildPopupUrl(this.appUrl, 'tx', {
            chainId: this.currentChainId(),
            tx: JSON.stringify(tx)
        });
        const result = (await openPopup({ url, appOrigin: this.appOrigin, timeoutMs: this.popupTimeoutMs })) as PopupTxPayload;
        if (result.type !== 'bitshard:tx') {
            throw new Error(`Unexpected popup response type: ${result.type}`);
        }
        return result.hash;
    }

    private async forwardToPublicClient(method: string, params: readonly unknown[]): Promise<unknown> {
        const client = this.getPublicClient(this.currentChainId());
        return client.request({ method: method as any, params: params as any });
    }

    private parseOptionalChainId(value: unknown): number | undefined {
        if (value === undefined || value === null) return undefined;
        if (typeof value === 'number') return value;
        if (typeof value === 'string') return value.startsWith('0x') ? parseInt(value, 16) : Number(value);
        if (typeof value === 'object' && 'chainId' in value) {
            return this.parseOptionalChainId((value as { chainId?: unknown }).chainId);
        }
        return undefined;
    }

    private getPublicClient(chainId: number): PublicClient {
        const cached = this.publicClientCache.get(chainId);
        if (cached) return cached;
        const chain = findChain(this.chains, chainId);
        if (!chain) throw new Error(`Chain ${chainId} not configured on BitShard connector`);
        const client = createPublicClient({ chain, transport: http() });
        this.publicClientCache.set(chainId, client);
        return client;
    }

    private requireSession(): void {
        if (!this.session) {
            const err: Error & { code?: number } = new Error('BitShard connector is not connected');
            err.code = 4100;
            throw err;
        }
    }
}
