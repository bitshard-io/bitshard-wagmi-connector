import type { BitShardSession } from './types.js';

const DEFAULT_PREFIX = 'bitshard.wagmi';

function getStorage(): Storage | null {
    try {
        if (typeof window === 'undefined') return null;
        return window.localStorage;
    } catch {
        return null;
    }
}

export function loadSession(prefix: string = DEFAULT_PREFIX): BitShardSession | null {
    const storage = getStorage();
    if (!storage) return null;
    try {
        const raw = storage.getItem(`${prefix}.session`);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as BitShardSession;
        if (
            typeof parsed?.address !== 'string' ||
            typeof parsed?.chainId !== 'number' ||
            typeof parsed?.expiresAt !== 'number'
        ) {
            return null;
        }
        if (parsed.expiresAt <= Date.now()) {
            storage.removeItem(`${prefix}.session`);
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

export function saveSession(session: BitShardSession, prefix: string = DEFAULT_PREFIX): void {
    const storage = getStorage();
    if (!storage) return;
    try {
        storage.setItem(`${prefix}.session`, JSON.stringify(session));
    } catch {
        // ignore quota / disabled storage
    }
}

export function clearSession(prefix: string = DEFAULT_PREFIX): void {
    const storage = getStorage();
    if (!storage) return;
    try {
        storage.removeItem(`${prefix}.session`);
    } catch {
        // ignore
    }
}
