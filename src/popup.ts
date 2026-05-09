import type { PopupResultPayload } from './types.js';

const DEFAULT_POPUP_TIMEOUT_MS = 5 * 60 * 1000;
const POPUP_FEATURES = 'width=480,height=720,menubar=no,toolbar=no,location=no,status=no';

export interface OpenPopupOptions {
    url: string;
    appOrigin: string;
    timeoutMs?: number;
}

/**
 * Open a centered popup pointed at the BitShard bridge page and await a
 * postMessage response from the matching origin.
 *
 * Resolves on the first message whose `type` begins with `bitshard:` (other
 * than `bitshard:ready`). Rejects on error payload, popup close, or timeout.
 */
export function openPopup(options: OpenPopupOptions): Promise<PopupResultPayload> {
    const { url, appOrigin } = options;
    const timeoutMs = options.timeoutMs ?? DEFAULT_POPUP_TIMEOUT_MS;

    if (typeof window === 'undefined' || typeof document === 'undefined') {
        return Promise.reject(new Error('BitShard wagmi connector requires a browser environment'));
    }

    const screenLeft = (window.screenLeft ?? window.screenX ?? 0);
    const screenTop = (window.screenTop ?? window.screenY ?? 0);
    const outerWidth = window.outerWidth || window.innerWidth || 1024;
    const outerHeight = window.outerHeight || window.innerHeight || 768;
    const left = Math.max(0, Math.round(screenLeft + (outerWidth - 480) / 2));
    const top = Math.max(0, Math.round(screenTop + (outerHeight - 720) / 2));
    const features = `${POPUP_FEATURES},left=${left},top=${top}`;

    const popup = window.open(url, 'bitshard-connector', features);
    if (!popup) {
        return Promise.reject(new Error('Popup blocked. Allow popups for this site and retry.'));
    }

    return new Promise<PopupResultPayload>((resolve, reject) => {
        let settled = false;
        const cleanup = () => {
            settled = true;
            window.removeEventListener('message', onMessage);
            if (pollHandle !== null) {
                window.clearInterval(pollHandle);
                pollHandle = null;
            }
            if (timeoutHandle !== null) {
                window.clearTimeout(timeoutHandle);
                timeoutHandle = null;
            }
        };

        const onMessage = (event: MessageEvent) => {
            if (event.origin !== appOrigin) return;
            const data = event.data as PopupResultPayload | { type?: string } | null;
            if (!data || typeof data !== 'object' || typeof (data as any).type !== 'string') return;
            const type = (data as any).type as string;
            if (!type.startsWith('bitshard:')) return;
            if (type === 'bitshard:ready') return;
            // bitshard:logout is handled globally by the provider; don't
            // resolve/reject any pending action on it (otherwise a user
            // clicking Sign out mid-connect would produce a bogus
            // "connected" payload).
            if (type === 'bitshard:logout') return;

            cleanup();

            try {
                if (!popup.closed) popup.close();
            } catch {
                // some browsers disallow closing cross-origin popups; ignore
            }

            if (type === 'bitshard:error') {
                const payload = data as { type: 'bitshard:error'; message?: string; code?: string };
                const err: Error & { code?: string } = new Error(payload.message || 'BitShard popup error');
                if (payload.code) err.code = payload.code;
                reject(err);
                return;
            }

            resolve(data as PopupResultPayload);
        };

        window.addEventListener('message', onMessage);

        let pollHandle: number | null = window.setInterval(() => {
            if (settled) return;
            if (popup.closed) {
                cleanup();
                reject(new Error('BitShard popup was closed before completing the request.'));
            }
        }, 400);

        let timeoutHandle: number | null = window.setTimeout(() => {
            if (settled) return;
            cleanup();
            try {
                if (!popup.closed) popup.close();
            } catch {
                // ignore
            }
            reject(new Error(`BitShard popup timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
    });
}

/**
 * Build the popup URL for a given action and payload.
 */
export function buildPopupUrl(
    appUrl: string,
    action: 'connect' | 'sign' | 'tx' | 'view' | 'tokens',
    params: Record<string, string | number | undefined | null>
): string {
    const base = appUrl.replace(/\/$/, '');
    const url = new URL(`${base}/connector`);
    url.searchParams.set('action', action);
    url.searchParams.set('origin', window.location.origin);
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null) continue;
        url.searchParams.set(key, String(value));
    }
    return url.toString();
}

/**
 * Open the BitShard popup in "view" mode for the given chainId. Unlike
 * {@link openPopup}, this does not wait for a `postMessage` response: it's a
 * fire-and-forget window that lets the user inspect their wallet for the
 * currently selected chain and close the popup when done.
 *
 * Returns the popup window reference (or `null` if the browser blocked it).
 */
export function openWalletViewer(options: {
    appUrl: string;
    chainId: number;
}): Window | null {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
        throw new Error('BitShard wagmi connector requires a browser environment');
    }
    const url = buildPopupUrl(options.appUrl, 'view', { chainId: options.chainId });
    const screenLeft = (window.screenLeft ?? window.screenX ?? 0);
    const screenTop = (window.screenTop ?? window.screenY ?? 0);
    const outerWidth = window.outerWidth || window.innerWidth || 1024;
    const outerHeight = window.outerHeight || window.innerHeight || 768;
    const left = Math.max(0, Math.round(screenLeft + (outerWidth - 480) / 2));
    const top = Math.max(0, Math.round(screenTop + (outerHeight - 720) / 2));
    const features = `${POPUP_FEATURES},left=${left},top=${top}`;
    return window.open(url, 'bitshard-viewer', features);
}

/**
 * Parse the `appUrl` parameter into its origin (for postMessage filtering).
 */
export function toOrigin(appUrl: string): string {
    try {
        return new URL(appUrl).origin;
    } catch {
        throw new Error(`Invalid appUrl for BitShard connector: ${appUrl}`);
    }
}
