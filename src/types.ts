import type { Chain } from 'viem';

export interface BitShardConnectorParameters {
    /**
     * Origin of the BitShard wallet app (e.g. https://wallet.bitshard.io).
     * The connector opens a popup to `${appUrl}/connector?action=...` to handle
     * authentication and signature approval.
     */
    appUrl: string;

    /**
     * Chains supported by the connector. Defaults to Arbitrum One, Nova, Sepolia.
     */
    chains?: readonly Chain[];

    /**
     * Popup timeout in milliseconds before rejecting pending requests.
     * Defaults to 300_000 (5 minutes).
     */
    popupTimeoutMs?: number;

    /**
     * LocalStorage prefix for persisted session state.
     * Defaults to 'bitshard.wagmi'.
     */
    storagePrefix?: string;
}

export interface BitShardSession {
    address: `0x${string}`;
    chainId: number;
    expiresAt: number;
}

export type PopupAction = 'connect' | 'sign' | 'tx' | 'view';

export interface PopupConnectedPayload {
    type: 'bitshard:connected';
    address: `0x${string}`;
    chainId: number;
    expiresAt?: number;
}

export interface PopupSignedPayload {
    type: 'bitshard:signed';
    signature: `0x${string}`;
}

export interface PopupTxPayload {
    type: 'bitshard:tx';
    hash: `0x${string}`;
}

export interface PopupErrorPayload {
    type: 'bitshard:error';
    message: string;
    code?: string;
}

export type PopupResultPayload =
    | PopupConnectedPayload
    | PopupSignedPayload
    | PopupTxPayload
    | PopupErrorPayload;
