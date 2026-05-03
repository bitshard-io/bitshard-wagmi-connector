# Testing `@bitshard.io/bitshard-wagmi-connector`

This package ships with two layers of automated tests, plus a documented end-to-end click-path against a running BitShard wallet stack.

---

## 1. Unit tests (jest + jsdom)

Mocks `@wagmi/core` so the connector is tested in isolation against a simulated popup window and `postMessage` channel.

```bash
npm install
npm test
```

Covered cases (see [tests/connector.test.ts](./tests/connector.test.ts)):

- connector `id` / `name` / `type` shape
- `connect()` opens popup, receives `bitshard:connected`, persists session
- silent reconnect from `localStorage` (no popup)
- `personal_sign` popup happy path
- `eth_sendTransaction` popup happy path
- popup-closed rejection
- cross-origin message filtering (ignores non-matching `event.origin`)
- explicit `bitshard:error` payload rejection

Expected output: `Tests: 8 passed, 8 total`.

## 2. Typecheck + build

```bash
npm run typecheck
npm run build       # emits dist/
```

`prepublishOnly` runs the build automatically when you `npm publish`.

---

## 3. End-to-end against a BitShard wallet stack

The connector opens a popup at `${appUrl}/connector` and exchanges `postMessage` payloads with that page. To exercise the full flow you need a BitShard wallet deployment running with:

- The wallet frontend serving `/connector` on its origin.
- The backend exposing `/v1/config/dapp-allowlist`, `/v1/wallet/status`, `/v1/wallet/local/status`, `/v1/wallet/sign-message`, `/v1/wallet/transactions/initiate`, `/v1/wallet/chains`, etc.
- Your dApp origin added to the backend's `DAPP_ORIGIN_ALLOWLIST` env var.

Use the public BitShard wallet (`https://wallet.bitshard.io`) or run the stack locally — see the main BitShard repo (`https://github.com/bitshard-io/bitshard`) for compose files and signer instructions.

### Click-path to verify

1. From your dApp, click **Connect BitShard**. A popup opens at `${appUrl}/connector?action=connect&origin=<dapp-origin>&chainId=421614`.
2. If the user is not signed in, the popup shows **Sign in**. Clicking it navigates the popup to Keycloak and back.
3. The popup shows the wallet picker (Local / MPC), address, chain, and tabs for Tokens/NFTs.
4. Clicking **Authorize** posts `{ type: 'bitshard:connected', address, chainId }` to the dApp; the dApp sees the address and reads its balance through the connector's viem public client (no popup).
5. **`personal_sign`** → popup re-opens at `?action=sign`. Local wallets sign synchronously; MPC wallets run the 2-of-3 ceremony (mobile + browser extension approve).
6. **`eth_sendTransaction`** → popup re-opens at `?action=tx`. After signing, the popup posts `{ type: 'bitshard:tx', hash }`.
7. **Chain switching**: switching to an unsupported chain in the dApp causes the popup to render an "Unsupported chain" screen and reject the request with `code: 'UNSUPPORTED_CHAIN'`.
8. **Wallet viewer**: `provider.viewWallet(chainId)` (also exported as `openWalletViewer`) opens a read-only popup with no `postMessage` round-trip.
9. **Sign out**: a "Sign out" link in the popup ends the Keycloak session and posts `{ type: 'bitshard:logout' }`. The connector listens globally for that message and clears the wagmi session automatically.

### Reconnect / persistence

After step 4, refresh the dApp. `isAuthorized()` returns `true` from `localStorage` (key `bitshard.wagmi.session`); no popup re-opens. Calling `disconnect()` clears it.

---

## 4. Troubleshooting

| Symptom | Fix |
|---|---|
| Popup shows "Opened standalone" | The dApp invoked the popup URL directly instead of via this connector. The bridge requires `window.opener`. |
| `Origin … is not allowed` | Add your dApp origin to the backend's `DAPP_ORIGIN_ALLOWLIST` env, restart the backend. |
| `Popup blocked` | The browser blocked `window.open`. Click "Allow popups for this site". |
| `personal_sign` returns 501 | Expected for distributed-MPC wallets today; backend follow-up. Use a local/demo wallet for message signing or wait for the mobile + extension `sign-message` handler. |
| `Cannot find module '@bitshard.io/bitshard-wagmi-connector'` | Run `npm install` and make sure you imported with the **scoped** name (`@bitshard.io/`, not bare). |
