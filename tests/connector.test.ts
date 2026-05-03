import { arbitrumSepolia } from 'viem/chains';

import { bitshard, BITSHARD_CONNECTOR_ID } from '../src/connector';

jest.mock('@wagmi/core', () => ({
    createConnector: (fn: any) => fn
}));

const APP_URL = 'https://wallet.bitshard.io';
const APP_ORIGIN = 'https://wallet.bitshard.io';
const TEST_ADDRESS = '0x1111111111111111111111111111111111111111';
const TEST_SIGNATURE = '0xdeadbeef';
const TEST_TX_HASH = '0xbadc0ffee';

type PopupStub = {
    closed: boolean;
    close: jest.Mock;
    location: { href: string };
};

let openCalls: string[] = [];
let popups: PopupStub[] = [];

function installWindowOpenStub() {
    openCalls = [];
    popups = [];
    (globalThis.window as any).open = jest.fn((url: string) => {
        openCalls.push(url);
        const popup: PopupStub = {
            closed: false,
            close: jest.fn(function (this: PopupStub) {
                this.closed = true;
            }),
            location: { href: url }
        };
        popups.push(popup);
        return popup as unknown as Window;
    });
}

function postFromPopup(payload: Record<string, unknown>, origin: string = APP_ORIGIN) {
    window.dispatchEvent(new MessageEvent('message', { data: payload, origin }));
}

function createMockConfig() {
    const listeners = new Map<string, Set<(data: any) => void>>();
    const emitter = {
        emit: jest.fn((event: string, data: any) => {
            listeners.get(event)?.forEach((l) => l(data));
        }),
        on: (event: string, listener: (data: any) => void) => {
            let set = listeners.get(event);
            if (!set) {
                set = new Set();
                listeners.set(event, set);
            }
            set.add(listener);
        },
        off: () => {},
        uid: 'mock'
    };
    return {
        chains: [arbitrumSepolia] as const,
        emitter,
        storage: null,
        transports: {}
    };
}

function makeConnector() {
    const factory = bitshard({ appUrl: APP_URL }) as unknown as (config: any) => any;
    const config = createMockConfig();
    return { connector: factory(config), config };
}

beforeEach(() => {
    window.localStorage.clear();
    installWindowOpenStub();
});

describe('bitshard() wagmi connector', () => {
    it('exposes the connector id, name, and type', () => {
        const { connector } = makeConnector();
        expect(connector.id).toBe(BITSHARD_CONNECTOR_ID);
        expect(connector.name).toBe('BitShard');
        expect(connector.type).toBe('bitshard');
    });

    it('connects via popup and returns accounts + chainId', async () => {
        const { connector } = makeConnector();

        const connectPromise = connector.connect();
        await Promise.resolve();
        postFromPopup({
            type: 'bitshard:connected',
            address: TEST_ADDRESS,
            chainId: arbitrumSepolia.id
        });

        const result = await connectPromise;
        expect(result.accounts).toHaveLength(1);
        expect(String(result.accounts[0]).toLowerCase()).toBe(TEST_ADDRESS.toLowerCase());
        expect(result.chainId).toBe(arbitrumSepolia.id);
        expect(openCalls[0]).toContain('/connector?action=connect');
        expect(popups[0].close).toHaveBeenCalled();
    });

    it('rehydrates from localStorage without opening a popup', async () => {
        window.localStorage.setItem(
            'bitshard.wagmi.session',
            JSON.stringify({
                address: TEST_ADDRESS,
                chainId: arbitrumSepolia.id,
                expiresAt: Date.now() + 60_000
            })
        );

        const { connector } = makeConnector();

        expect(await connector.isAuthorized()).toBe(true);
        const accounts = await connector.getAccounts();
        expect(accounts).toHaveLength(1);
        expect(String(accounts[0]).toLowerCase()).toBe(TEST_ADDRESS.toLowerCase());
        expect(openCalls).toHaveLength(0);
    });

    it('signs a personal message via popup', async () => {
        window.localStorage.setItem(
            'bitshard.wagmi.session',
            JSON.stringify({
                address: TEST_ADDRESS,
                chainId: arbitrumSepolia.id,
                expiresAt: Date.now() + 60_000
            })
        );

        const { connector } = makeConnector();
        const provider = await connector.getProvider();

        const signPromise = provider.request({
            method: 'personal_sign',
            params: ['hello', TEST_ADDRESS]
        });
        await Promise.resolve();
        postFromPopup({ type: 'bitshard:signed', signature: TEST_SIGNATURE });

        expect(await signPromise).toBe(TEST_SIGNATURE);
        expect(openCalls[0]).toContain('/connector?action=sign');
    });

    it('sends a transaction via popup and returns the tx hash', async () => {
        window.localStorage.setItem(
            'bitshard.wagmi.session',
            JSON.stringify({
                address: TEST_ADDRESS,
                chainId: arbitrumSepolia.id,
                expiresAt: Date.now() + 60_000
            })
        );

        const { connector } = makeConnector();
        const provider = await connector.getProvider();

        const txPromise = provider.request({
            method: 'eth_sendTransaction',
            params: [{ to: '0x2222222222222222222222222222222222222222', value: '0x1' }]
        });
        await Promise.resolve();
        postFromPopup({ type: 'bitshard:tx', hash: TEST_TX_HASH });

        expect(await txPromise).toBe(TEST_TX_HASH);
        expect(openCalls[0]).toContain('/connector?action=tx');
    });

    it('rejects when the popup is closed before responding', async () => {
        const { connector } = makeConnector();
        const connectPromise = connector.connect();
        await Promise.resolve();

        popups[0].closed = true;
        await expect(connectPromise).rejects.toThrow(/closed before completing/);
    });

    it('ignores messages from a non-matching origin', async () => {
        const { connector } = makeConnector();
        const connectPromise = connector.connect();
        await Promise.resolve();

        postFromPopup(
            { type: 'bitshard:connected', address: TEST_ADDRESS, chainId: arbitrumSepolia.id },
            'https://evil.example.com'
        );
        popups[0].closed = true;

        await expect(connectPromise).rejects.toThrow(/closed before completing/);
    });

    it('rejects on explicit error payload from the popup', async () => {
        const { connector } = makeConnector();
        const connectPromise = connector.connect();
        await Promise.resolve();

        postFromPopup({ type: 'bitshard:error', message: 'user rejected', code: 'USER_REJECTED' });

        await expect(connectPromise).rejects.toThrow(/user rejected/);
    });
});
