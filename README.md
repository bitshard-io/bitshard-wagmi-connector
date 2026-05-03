# @bitshard.io/bitshard-wagmi-connector

[![npm version](https://img.shields.io/npm/v/@bitshard.io/bitshard-wagmi-connector.svg)](https://www.npmjs.com/package/@bitshard.io/bitshard-wagmi-connector)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Wagmi connector for the [BitShard](https://bitshard.io) MPC wallet.

BitShard is a non-custodial wallet that uses 2-of-3 threshold signatures: the user's shares live on their mobile app and browser extension, and a third share lives on the BitShard server. This connector lets any wagmi-powered dApp connect to a BitShard wallet without the user installing any browser extension for the dApp itself — authentication and signature approval happen in a popup to `wallet.bitshard.io`.

## Install

```bash
npm install @bitshard.io/bitshard-wagmi-connector @wagmi/core viem
```

Peer dependencies: `@wagmi/core ^2`, `viem ^2`.

## Usage

```ts
import { createConfig, http } from '@wagmi/core';
import { arbitrumSepolia } from '@wagmi/core/chains';
import { bitshard } from '@bitshard.io/bitshard-wagmi-connector';

export const config = createConfig({
  chains: [arbitrumSepolia],
  connectors: [
    bitshard({
      appUrl: 'https://wallet.bitshard.io'
    })
  ],
  transports: {
    [arbitrumSepolia.id]: http()
  }
});
```

### With React

```tsx
import { WagmiProvider, useAccount, useConnect, useSignMessage } from 'wagmi';

function ConnectButton() {
  const { connect, connectors } = useConnect();
  const bitshardConnector = connectors.find((c) => c.id === 'bitshard');
  return <button onClick={() => connect({ connector: bitshardConnector! })}>Connect BitShard</button>;
}
```

## Parameters

### `appUrl` (required)

`string` — Origin of the BitShard wallet app (for example, `https://wallet.bitshard.io`). The connector opens a popup at `${appUrl}/connector?action=...` to handle authentication and signature approval.

### `chains`

`readonly Chain[]` — Chains supported by this connector. Defaults to Arbitrum One, Nova, and Sepolia.

### `popupTimeoutMs`

`number` — How long to wait for the popup to return a response before rejecting. Defaults to `300_000` (5 minutes).

### `storagePrefix`

`string` — LocalStorage prefix for persisted session state. Defaults to `'bitshard.wagmi'`.

## Architecture

The connector is architecturally a thin EIP-1193 popup proxy. It does not run DKLS, doesn't generate or hold keyshares, and never sees private material. All MPC heavy lifting happens inside the BitShard popup window (`/connector` page on the wallet origin), the BitShard backend, the mobile app, and the browser extension.

That's why the only runtime peers are `@wagmi/core` and `viem` — no DKLS WASM, no `ws`, no ethers — keeping the dApp bundle small and the trust boundary obvious.

## How it works

1. `connect()` → popup opens at `${appUrl}/connector?action=connect`. The user logs in through Keycloak on the BitShard wallet domain, and the bridge page `postMessage`s `{ type: 'bitshard:connected', address, chainId }` back to the dApp.
2. `personal_sign` / `eth_signTypedData_v4` → popup opens at `${appUrl}/connector?action=sign`. The BitShard app runs the existing 2-of-3 MPC signing ceremony (user approves on mobile + browser extension), then posts back `{ type: 'bitshard:signed', signature }`.
3. `eth_sendTransaction` → popup opens at `${appUrl}/connector?action=tx`. Same MPC ceremony, then broadcast, then posts back `{ type: 'bitshard:tx', hash }`.
4. Read-only methods (`eth_call`, `eth_getBalance`, etc.) are forwarded to a `viem` public client — no popup needed.

Session state (address, chainId, expiry) is persisted in `localStorage`. Wagmi's `reconnect` hydrates silently from storage without re-opening the popup.

## Development

```bash
npm install
npm run build       # tsc -> dist/
npm test            # jest (jsdom)
npm run typecheck
```

## Publishing

Maintainers only. Bump the version in `package.json`, then:

```bash
git commit -am "<version>"
git tag v<version>
git push origin main
git push origin v<version>

npm publish --access public
```

## License

MIT — see [LICENSE](./LICENSE).
