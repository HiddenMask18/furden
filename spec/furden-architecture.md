# furden — Architecture Document v0.1

This document records the technical design decisions for the furden client: what was decided, why, and what alternatives were considered and rejected. It is a companion to [DESIGN.md](../DESIGN.md), which covers product and UX decisions, and to [PROTOCOL.md](../PROTOCOL.md), which defines the cryptographic and API contract between furden and a DEN instance.

Where DESIGN.md says what the user experience must be, and PROTOCOL.md says what the client must compute, this document says how the client is built — the architecture of the code itself.

Decisions recorded here as resolved are not open for re-litigation without a deliberate revision. Open questions are flagged explicitly in Appendix B and represent known gaps to be resolved before the flows that depend on them are implemented.

---

## Foundational Constraints

These constraints flow directly from the DEN protocol and cannot be negotiated by any architectural decision in this document. They are not furden's design choices — they are requirements the protocol imposes on any compliant client.

**Session tokens are memory-only.** The session token returned by `POST /auth/verify` is stored in memory and never written to localStorage, sessionStorage, IndexedDB, or any other browser-persistent storage. Page refresh requires re-authentication. This is correct protocol behaviour, not a limitation to work around.

**The master secret never leaves the client in plaintext.** The 32-byte master secret generated during creator onboarding is held in memory for the duration of the session only. It is never transmitted in plaintext, never written to any storage, and never exposed outside the crypto layer. It must be cleared from memory on wallet disconnect and on session end.

**All cryptography is client-side.** Key generation, content encryption, content decryption, access grant signing — all happen in the browser. The instance stores ciphertext and derives content keys server-side from the encrypted operational blob; it never has access to plaintext content or the plaintext master secret.

**No SSR.** The in-memory session model requires a pure client-side runtime. Server-side rendering is architecturally incompatible. This is not a framework preference — it is a consequence of the session model.

**Web Crypto API throughout.** The crypto layer uses `@noble/curves`, `@noble/hashes`, and the Web Crypto API as specified in PROTOCOL.md. These are not substitutable. Any replacement produces ciphertext incompatible with the instance's `decryptBlob` implementation.

---

## Section 0 — Definitions

**Purpose:** Establish shared vocabulary used throughout this document and throughout the codebase. Terms defined here are used without re-definition in later sections.

---

**Session** — the authenticated state created by completing the `GET /auth/challenge` + `POST /auth/verify` sequence against a DEN instance. A session consists of a session token (opaque bearer token for API calls) and the proxy address bound to the authenticated wallet. Sessions are memory-only and end on page refresh, wallet disconnect, or session token expiry.

**Proxy address** — the stable DEN identity address (`0x...`) for a participant. Assigned by `DENIdentityRegistry.register()` and never changes, even across wallet rotations. All internal application state, routing, and on-chain references use the proxy address, not the wallet address. The wallet address is only used for signing operations.

**Session token** — the opaque bearer token returned by `POST /auth/verify`. Sent as `Authorization: Bearer <token>` on all authenticated instance API calls. Stored in the session Zustand store. Never persisted to any browser storage.

**Master secret** — the 32-byte secret generated during creator onboarding via `crypto.getRandomValues(new Uint8Array(32))`. Root of all content key derivation. Held in memory in the crypto Zustand store during an active creator session. Cleared on disconnect. Never transmitted in plaintext, never written to storage.

**Content key** — a 32-byte AES-256-GCM key. For paywalled content: derived from the master secret via `HKDF-SHA256(ikm=masterSecret, salt=none, info=path)`, unique per tier derivation path (e.g. `"tier:1"`); subscribers receive it from `POST /access/key` — the instance derives it server-side. For public content: a **fresh random per-post key** (`crypto.getRandomValues`), supplied as the `contentKey` field and published in the profile. Derived keys are never published — a tier key as a public `contentKey` would unlock the entire tier for anyone (see Appendix A, "Public content keys").

**Post envelope** — the plaintext serialisation of a post (body text + zero or more images) into a single binary container: `"DENP"` magic, version byte, length-prefixed JSON header (text, image manifest with byte lengths, MIME types, and pixel dimensions), then raw image bytes. One post = one envelope = one encrypted blob = one fingerprint = one `registerContent` transaction. Defined normatively in PROTOCOL.md §Post envelope; implemented as pure functions in `src/lib/envelope.ts`.

**Fingerprint** — the SHA-256 hash of a content blob's ciphertext bytes, computed server-side by the instance after upload (`POST /creator/content`). The client does not know the fingerprint before the upload completes. On-chain registration (`DENContentRegistry.registerContent`) requires the fingerprint returned by the upload response. Because one post is one blob, the fingerprint is also the post's stable identity — permalinks key on it.

**Operational blob** — the master secret encrypted to the instance's per-creator public key using ECIES. Stored on the instance. Allows the instance to derive content keys for subscriber access without holding the plaintext master secret. Defined in PROTOCOL.md §ECIES.

**Portability blob** — the master secret encrypted to the creator's wallet public key using ECIES. Stored on the instance alongside the operational blob. Used by the creator to recover the master secret during instance migration. Defined in PROTOCOL.md §ECIES.

**Access grant** — a creator-signed declaration stored on the instance and published on-chain, mapping a tier ID to derivation paths (e.g. `["tier:1"]`). The instance verifies grants on every key request. Grants must be re-signed after wallet rotation because the signature is verified against the current primary wallet.

**Trust tier** — the creator's on-chain tier (0–3) derived from verified distinct subscriber count, read from `DENTrustTier.getTier()`. Governs upload size and rate limits. Displayed in the studio; enforced client-side before upload to avoid 413/429 responses.

**Governance parameters** — on-chain values controlling protocol behaviour, fetched at startup from `GET /governance/params`. The client displays the protocol fee (`fees.protocol_fee_bps`) in subscription pricing UI and enforces post size limits (`trust_tiers.post_size_limits`) before upload.

**Chain indicator** — the persistent UI element showing whether the client is connected to Base mainnet or Base Sepolia. Always visible. Not dismissible. Testnet connection carries a distinct visual treatment to prevent real-money actions on the wrong network.

---

## Section 1 — Protocol Constraints on the UI

**Purpose:** Record how the DEN protocol's cryptographic and access control architecture shapes specific UI decisions. These are not design preferences — they are the places where the protocol determines the only correct implementation.

**Scope:**
- Session recovery behaviour on page refresh
- Re-authentication labelling
- Content key request failure handling
- Decryption latency handling
- Fingerprint availability timing
- Content warning enforcement
- Proxy address as routing key

---

**Session recovery on refresh.** Because session tokens are memory-only, every page load begins unauthenticated. If a wallet is already connected (detected via wagmi's `useAccount`), the client fires the auth challenge immediately and prompts the wallet signature. This is not an error state — it is session initiation. The prompt is labelled "Sign in to your DEN session", not "Session expired" or "Authentication error." A user who rejects the signature sees a non-blocking banner: "You're not signed in. [Sign in →]". Public content remains accessible. See Section 5 for full session lifecycle.

**Re-authentication is not an error.** The session model means re-auth happens on every page load after wallet connection. It is expected, fast, and silent in the normal case. It must be communicated as initiation ("Sign in to your DEN session") and never as failure. The word "expired" does not appear in this flow.

**Content key failure is always possible.** The instance verifies subscription state live on every `POST /access/key` call. A key request can fail at any point — including mid-session if a subscription lapses between page load and content access. Every content access path must handle denial gracefully. The correct response to a key request failure is not a crash or an unhandled error boundary — it is a locked-content card with a "Subscribe to unlock" or "Renew subscription" call to action.

**Decryption adds latency after download.** Content arrives as ciphertext and is decrypted locally after the download completes. For large files this produces visible latency between "download complete" and "image renders." The UX must account for this: the content card skeleton stays visible until decryption completes, not until download completes. For files taking more than 300ms to decrypt, a subtle inline spinner replaces the skeleton. There is no persistent "Decrypting..." label — the normal case must feel instantaneous.

**Fingerprint timing.** The content fingerprint is computed server-side from the uploaded ciphertext. The client does not know it before the upload completes. The on-chain registration step (`DENContentRegistry.registerContent`) cannot be initiated until the upload response returns the fingerprint. The posting flow is designed around this constraint: Phase 3 cannot begin until Phase 2 returns.

**Content warnings are mandatory.** Any post with content warnings in its metadata is blurred by default, regardless of subscription state. The client has no discretion here — the creator declared the warning and the client must apply the blur-and-acknowledge pattern. The acknowledgement is per-session per-card. There is no global "accept all" preference. This is protocol behaviour, not a user preference setting.

**Route by proxy, display by handle.** The proxy address is the stable identifier. Handles are display aliases only — they can change (rate-limited) and resolve to the proxy. Internal routing, API calls, and on-chain operations always use the proxy address. A creator's profile route is keyed to their proxy address (`/$handle` resolves handle → proxy at load time). If a handle changes, links using the old handle route correctly for the duration of the `handle_alias_retention_window` governance parameter.

---

## Section 2 — Environment & Configuration

**Purpose:** Define every environment variable the application reads, what it does, whether it is required, and how the application behaves in its absence.

**Scope:**
- Complete env var surface with types and defaults
- Contract address sourcing strategy
- Chain selection mechanism
- WalletConnect project ID handling
- Development vs. testnet vs. mainnet distinction

---

### Contract address sourcing

Contract addresses are **constants per chain in source code**, not environment variables. The DEN protocol contracts are a single canonical deployment per chain — they are not per-instance or per-operator. Every furden deployment on Base mainnet uses the same contract addresses. Every furden deployment on Base Sepolia uses the same testnet addresses.

Environment variables for contract addresses would add 7+ required configuration values with no benefit — the addresses are protocol constants, not deployment decisions. Operators running furden self-hosted do not choose different contract addresses any more than they choose a different EVM.

For local development (Anvil), addresses vary per deployment. The dev override pattern handles this: contract addresses default to the chain constants but can be overridden via env vars when the chain ID is 31337.

**Design rationale:** The rejected alternative was sourcing contract addresses from the instance API (`GET /config`). This would make furden portable to any chain the instance supports without a redeploy. The cost is a required network request before any chain interaction can be wired up, a failure mode at startup if the config endpoint is unavailable, and complexity in the wagmi config initialization. Given that DEN v1 is Base-only and contract addresses are canonical and stable, the config fetch adds complexity with no benefit at this stage. Revisit when multi-chain instance support is in scope.

---

### Environment variables

```
VITE_CHAIN_ID
  Required. The chain ID to connect to.
  Values: 8453 (Base mainnet), 84532 (Base Sepolia), 31337 (Anvil local dev)
  Determines: which contract address constants are used, which viem chain object
  is passed to wagmi, and which block explorer URL appears in transaction links.

VITE_INSTANCE_URL
  Required. The base URL of the DEN instance furden connects to.
  Example: https://instance.example.com
  No trailing slash. Used as the base for all instance API calls.
  The onboarding wizard uses DESIGN.md §Flow 2 Step 4 — if this env var is set
  (which it is for any normal deployment), the instance selection step is skipped
  and a confirmation is shown instead: "You're connected to [instance name]."

VITE_INSTANCE_NAME
  Optional. Human-readable display name for the configured instance, shown in
  attribution copy ("Hosted on [name]", "You're connected to [name]").
  If absent: furden falls back to the host portion of VITE_INSTANCE_URL, so the
  label is never blank. The instance API exposes no name field — this is a
  client-side deployment label, not fetched from the instance.

VITE_WALLETCONNECT_PROJECT_ID
  Optional. WalletConnect Cloud project ID.
  Source: https://cloud.walletconnect.com
  If absent: WalletConnect connector is excluded from the wagmi config.
  The connection modal shows only MetaMask and Coinbase Wallet.
  Graceful degradation is the correct behaviour — do not show a broken connector.

VITE_BLOCK_EXPLORER_URL
  Optional. Override for the block explorer URL used in transaction links.
  Default: https://basescan.org (mainnet) or https://sepolia.basescan.org (Sepolia)
  or https://localhost (Anvil — links are non-functional but present).
  Determined automatically from VITE_CHAIN_ID if not set.
```

**Dev-only overrides (only read when `VITE_CHAIN_ID=31337`):**

```
VITE_DEV_IDENTITY_REGISTRY_ADDRESS
VITE_DEV_SUBSCRIPTION_ADDRESS
VITE_DEV_CONTENT_REGISTRY_ADDRESS
VITE_DEV_ACCESS_GRANT_ADDRESS
VITE_DEV_GOVERNANCE_ADDRESS
VITE_DEV_TRUST_TIER_ADDRESS
VITE_DEV_REPORT_REGISTRY_ADDRESS
  Each optional. Override the contract address for the named contract.
  Only read when VITE_CHAIN_ID is 31337 (local Anvil).
  On mainnet or Sepolia these variables are silently ignored even if present.
```

### `.env.example`

```
# Required
VITE_CHAIN_ID=84532
VITE_INSTANCE_URL=https://your-instance.example.com

# Optional — instance display name (falls back to the hostname of VITE_INSTANCE_URL)
VITE_INSTANCE_NAME=

# Optional — WalletConnect (mobile wallet support)
# Get a project ID at https://cloud.walletconnect.com
# If absent, only MetaMask and Coinbase Wallet are available
VITE_WALLETCONNECT_PROJECT_ID=

# Optional — block explorer override
# Defaults: 8453=https://basescan.org, 84532=https://sepolia.basescan.org
# VITE_BLOCK_EXPLORER_URL=

# Dev-only — Anvil contract addresses (VITE_CHAIN_ID=31337 only)
# VITE_DEV_IDENTITY_REGISTRY_ADDRESS=
# VITE_DEV_SUBSCRIPTION_ADDRESS=
# VITE_DEV_CONTENT_REGISTRY_ADDRESS=
# VITE_DEV_ACCESS_GRANT_ADDRESS=
# VITE_DEV_GOVERNANCE_ADDRESS=
# VITE_DEV_TRUST_TIER_ADDRESS=
# VITE_DEV_REPORT_REGISTRY_ADDRESS=
```

---

## Section 3 — Chain & Wallet Layer

**Purpose:** Define the wagmi configuration, supported wallet connectors, chain objects, and how contract addresses are resolved from the chain ID.

**Scope:**
- Chain objects and block explorer URLs
- Supported wallet connectors and graceful degradation
- Contract address registry pattern
- Chain ID to configuration mapping
- `src/lib/chain.ts` structure

---

### Chain configuration

Two supported chains for v1. Chain objects come from `viem/chains`.

| Chain | ID | RPC | Block explorer |
|---|---|---|---|
| Base mainnet | 8453 | `https://mainnet.base.org` (default) | `https://basescan.org` |
| Base Sepolia | 84532 | `https://sepolia.base.org` (default) | `https://sepolia.basescan.org` |
| Anvil (dev) | 31337 | `http://127.0.0.1:8545` | n/a |

Custom RPC URLs are not exposed as env vars in v1. viem supports multiple transport fallbacks and the default public endpoints are sufficient for the expected request volume at launch. Revisit when rate limiting becomes an operational concern.

### Wallet connectors

Three connectors in priority order:

1. **Injected (MetaMask, Rabby, Brave Wallet)** — always present. The `injected()` connector from wagmi picks up any EIP-1193 injected provider. No configuration required.
2. **Coinbase Wallet** — always present. The `coinbaseWallet()` connector. Requires the app name (`"furden"`). No project ID required.
3. **WalletConnect** — conditional on `VITE_WALLETCONNECT_PROJECT_ID` being set. The `walletConnect()` connector. If the env var is absent the connector is omitted from the array at runtime. The connection UI does not show a broken WalletConnect option.

**Design rationale — no RainbowKit or Web3Modal:** Pre-built connection modal kits impose visual constraints incompatible with furden's design direction and bundle styles that conflict with the CSS Modules approach. The connection modal is built directly on wagmi's `useConnect` hook using Radix UI `Dialog`. The extra implementation effort is modest and the visual control is complete.

### Contract address registry

`src/lib/chain.ts` exports a `getContracts(chainId)` function that returns the address set for the given chain. On chain 31337, the dev env var overrides are applied if set.

```ts
// Shape of the contracts object
type ContractAddresses = {
  identityRegistry:  Address
  subscription:      Address
  contentRegistry:   Address
  accessGrant:       Address
  governance:        Address
  trustTier:         Address
  reportRegistry:    Address
}
```

Mainnet and Sepolia addresses are populated once canonical deployments exist. Until then `getContracts(8453)` and `getContracts(84532)` throw with a clear message: "Contracts not yet deployed on this network." This surfaces misconfiguration at startup rather than silently failing at the first contract call.

### Token metadata and price display

Subscription tiers reference a payment token by contract address only. To render human-readable prices, furden reads the ERC-20 `symbol()` and `decimals()` on-chain via viem and caches them per token (both are immutable). `address(0)` is the ETH sentinel — it renders as "ETH" with 18 decimals and is not a contract call.

The native token amount is always shown and is the source of truth (it is the amount actually charged on-chain). An approximate fiat figure ("~$5") is layered on top as a comprehension aid, read from a **Chainlink price feed on Base** via viem (the same on-chain read pattern as `symbol()`/`decimals()` above) and cached via TanStack Query. The token→feed mapping is a small built-in registry of Chainlink aggregator addresses keyed by token contract (ETH and the common stablecoins — USDC, DAI, USDT); a token with **no known feed has its fiat figure omitted entirely**, silently, with no fallback to any centralized price API. The fiat figure carries a leading "~", never blocks rendering, and never implies the charge is denominated in fiat. This satisfies den-spec §3.5 ("exchange rates for display SHOULD use Chainlink or equivalent decentralized price oracles") and keeps the price-display path free of any centralized dependency or third-party browsing-pattern leak. See Appendix A, "Subscription price display."

---

## Section 4 — State Management

**Purpose:** Define the Zustand store structure — how many stores, what each holds, lifecycle rules for each piece of state, and why the stores are split this way.

**Scope:**
- Store boundaries and rationale for the split
- Session store slice
- Crypto store slice and master secret lifecycle
- Upload pipeline store
- Governance params store
- What is explicitly not stored in Zustand

---

### Store boundaries

Four separate Zustand stores, each imported independently. Components only subscribe to the stores they need.

```
useSessionStore    — auth token, proxy, wallet address
useCryptoStore     — master secret, content key cache  (devtools disabled)
usePipelineStore   — in-memory upload state between posting phases
useGovernanceStore — protocol governance parameters (fetched once at startup)
```

**Design rationale — separate stores over slices:** A single store with slices would require every component that reads session state to also subscribe to crypto and pipeline state, triggering re-renders on changes it doesn't care about. Separate stores give granular subscriptions. More importantly, `useCryptoStore` requires devtools disabled — the master secret must not appear in Redux DevTools or any browser extension. A single store cannot have devtools disabled for only part of its state.

### Session store (`useSessionStore`)

```ts
type SessionStore = {
  token:         string | null   // bearer token for instance API calls
  proxy:         Address | null  // creator's stable DEN identity address
  walletAddress: Address | null  // connected wallet address (for signing)
  isCreator:     boolean         // true if creator setup is complete on the configured instance
  setSession:    (token: string, proxy: Address, walletAddress: Address) => void
  setIsCreator:  (v: boolean) => void
  clearSession:  () => void
}
```

`clearSession` is called on wallet disconnect and on any 401 response from the instance. It sets all fields to null/false. The UI transitions to unauthenticated state immediately — no pending requests are aborted; they will fail with the next API call and surface the reconnect banner.

`isCreator` is derived from `GET /creator/blob` → `{ exists }` on the configured instance after session establishment. It cannot be derived from `DENIdentityRegistry.isRegistered()` — every participant registers, subscribers included, and authentication already requires registration, so that read is true for every session. The signal that distinguishes a creator is having completed creator setup on this instance: the operational blob exists. A creator hosted on a *different* instance reads as `isCreator: false` here, which is correct — the studio manages content on the configured instance, and that creator's studio lives on their home instance. See Appendix A, "isCreator — operational blob existence."

**Subscriber registration.** Every participant — creators and subscribers alike — must call `DENIdentityRegistry.register()` before they can authenticate with any instance. The instance's `POST /auth/verify` checks `isRegistered()` and returns 401 for unregistered wallets. Subscribers who attempt to authenticate without registering will not receive a session token. The subscriber onboarding flow must include the `register()` call as a prerequisite to the subscription flow, with the same three-step transaction progress component used elsewhere. The `proxy` returned from auth is always a valid registered proxy — there is no null proxy case for an authenticated session.

### Crypto store (`useCryptoStore`)

Devtools disabled. Never logged. Never serialized.

```ts
type CryptoStore = {
  masterSecret: Uint8Array | null  // creator's master secret — held during session only
  contentKeys:  Map<string, Uint8Array>  // key: `${creatorProxy}:${tierId}`
  setMasterSecret: (secret: Uint8Array) => void
  clearMasterSecret: () => void
  cacheContentKey: (creatorProxy: Address, tierId: number, key: Uint8Array) => void
  getContentKey:   (creatorProxy: Address, tierId: number) => Uint8Array | null
  clearAll:        () => void
}
```

**Master secret lifecycle:** Set during creator onboarding after the operational blob upload succeeds. Held for the session. Cleared by `clearAll()` on wallet disconnect, on `clearSession()`, and on page unload via a `beforeunload` listener. It is never read outside of crypto operations in `src/lib/crypto.ts`.

**Content key cache:** Populated when the instance returns keys from `POST /access/key`. Keyed by `${creatorProxy}:${tierId}`. A cached key is used for all subsequent decryption of content under that tier in the same session without re-requesting. Cleared on `clearAll()`. The cache does not persist across sessions — every session re-requests keys as needed.

**Design rationale — why cache content keys:** The instance verifies subscription state live on every key request. Each request involves a network round-trip and an on-chain state read. For a feed with 20 posts under the same tier, requesting a key 20 times is unnecessary load and latency. Caching the returned key for the session duration is safe because: (a) the key is correct — the instance verified entitlement when it was issued; (b) a subscription lapsing mid-session is handled by the key request failure path, not by proactive cache invalidation; (c) the cache is in-memory and cleared on disconnect.

### Upload pipeline store (`usePipelineStore`)

Holds state across the three phases of the posting flow (encrypt → upload → register on-chain). This state must survive React component unmounts during the flow — storing it in component state would lose it if the user navigates.

```ts
type PipelineStore = {
  phase:           'idle' | 'encrypting' | 'uploading' | 'registering' | 'done' | 'error'
  encryptedBlob:   Uint8Array | null  // the encrypted post envelope — one blob per post
  fingerprint:     string | null      // returned after upload
  tierId:          number | null      // 0 = public post (reserved)
  error:           PipelineError | null
  startEncryption: (tierId: number) => void
  setEncrypted:    (blob: Uint8Array) => void
  setFingerprint:  (fp: string) => void
  setPhase:        (phase: PipelineStore['phase']) => void
  setError:        (err: PipelineError) => void
  clear:           () => void
}
```

**`encryptedBlob` lifecycle:** Set after Phase 1 (envelope build + local encryption) completes. Held through Phase 2 (upload) so the upload can be retried without re-encrypting if the network fails. Cleared after Phase 3 (on-chain registration) succeeds or on explicit `clear()`. Not cleared on Phase 2 failure — the retry path depends on it. One post is one envelope is one blob, so the singular `encryptedBlob`/`fingerprint` pair is the whole pipeline state — there is no per-file bookkeeping.

**Design rationale:** The encrypted blob can be large (multiple megabytes for image posts). Storing it in Zustand means it lives in the JS heap alongside the rest of the store. This is intentional — it is not written to disk and it is cleared as soon as the post succeeds. The alternative (Web Worker with postMessage) is deferred to v1.x per DESIGN.md; a single `Uint8Array` moves to a Worker as a `Transferable` with zero copies when that time comes.

### Governance store (`useGovernanceStore`)

```ts
type GovernanceStore = {
  params:  GovernanceParams | null
  status:  'idle' | 'loading' | 'ready' | 'error'
  fetch:   () => Promise<void>
}
```

Fetched once at application startup via `GET /governance/params`. Read-only after fetch. If the fetch fails, the store enters `'error'` status and the app proceeds with default values baked into the source (conservative: tier 0 limits, 2.5% fee). The governance params are non-critical for authentication and content viewing — they are used for upload limit enforcement and fee display. A startup failure should not block the application.

**What is not in Zustand:**
- Wallet connection state — owned by wagmi's internal store, accessed via `useAccount`, `useConnect`, etc.
- Server-fetched data (profiles, content lists, subscription status) — owned by TanStack Query
- UI state local to a single component (modal open/closed, form field values) — React `useState`
- Route params and navigation state — TanStack Router

---

## Section 5 — Authentication & Session

**Purpose:** Define the session lifecycle precisely: how sessions start, how they are recovered on refresh, how expiry is handled mid-session, and what happens on disconnect.

**Scope:**
- Auth challenge/verify sequence
- Automatic re-auth on page load when wallet is connected
- Mid-session token expiry handling
- Wallet disconnect handling
- Session state transitions

---

### Session lifecycle

**1. Page load, wallet already connected:**

wagmi's `useAccount` resolves immediately from its persisted connection state (wagmi persists the connection type, not the session token). If `account.status === 'connected'`:
- Fire `GET /auth/challenge?wallet=0x...` immediately
- Show wallet signature prompt: "Sign in to your DEN session"
- On signature: `POST /auth/verify { wallet, nonce, signature }`
- On success: call `setSession(token, proxy, walletAddress)` on `useSessionStore`
- Fire `GET /creator/blob` to set `isCreator` (operational blob exists on this instance — see Section 4)
- UI resolves to authenticated state

This sequence runs in a root-level component effect on first mount. It is not blocking — public routes render immediately; authenticated routes show a loading state until the session resolves.

**2. Page load, no wallet connected:**

Renders in fully unauthenticated state. No prompt. User connects wallet manually via the wallet badge in the header.

**3. Wallet connected mid-session (user clicks "Connect Wallet"):**

Same challenge/verify sequence as above, triggered by the wallet connection event from wagmi.

**4. Mid-session token expiry (401 from instance):**

Instance sessions expire after 24 hours. Any 401 response from any authenticated instance API call triggers:
- `clearSession()` on `useSessionStore`
- Non-blocking banner: "Your session ended. [Sign in again →]"
- In-progress actions (e.g. an upload in progress) are not aborted — they complete or fail on their own, then surface the re-auth banner
- Clicking the banner re-fires the challenge/verify sequence

**5. Wallet disconnect:**

wagmi fires a disconnect event. On disconnect:
- `clearSession()` on `useSessionStore`
- `clearAll()` on `useCryptoStore`
- `clear()` on `usePipelineStore`
- UI transitions to unauthenticated state

Any active upload is abandoned. The encrypted blobs in the pipeline store are cleared. The user is not warned mid-upload if they disconnect — wallet disconnect is a deliberate action.

**6. `beforeunload`:**

A listener on `window.beforeunload` calls `useCryptoStore.clearAll()`. This clears the master secret and content key cache before the page is torn down. This is best-effort — browsers do not guarantee synchronous execution of beforeunload handlers, but it is the correct place for this cleanup.

---

## Section 6 — Routing & Navigation

**Purpose:** Define the TanStack Router configuration: context shape, file-based route conventions, auth guard pattern, and how the three access contexts (public / subscriber / creator studio) are enforced.

**Scope:**
- Router context shape
- File-based route tree (matching DESIGN.md IA)
- Auth guard implementation via `beforeLoad`
- Redirect targets for unauthenticated access attempts
- Studio route separation

---

### Router context

TanStack Router's typed context is passed at router creation and updated on every navigation. The context carries session state so routes can access it in `beforeLoad` without importing Zustand directly.

```ts
type RouterContext = {
  session: {
    token:         string | null
    proxy:         Address | null
    walletAddress: Address | null
    isCreator:     boolean
  }
}
```

The context is populated from `useSessionStore` in the root route component and passed down. TanStack Router re-runs `beforeLoad` on context changes, so a session that resolves asynchronously (re-auth on page load) correctly unblocks protected routes once the token is set.

### Auth guard pattern

Three access levels, implemented as `beforeLoad` on the appropriate route or route group:

```ts
// Subscriber guard — wallet connected + active session
beforeLoad: ({ context }) => {
  if (!context.session.token) {
    throw redirect({ to: '/connect', search: { from: location.href } })
  }
}

// Creator guard — session + registered creator identity
beforeLoad: ({ context }) => {
  if (!context.session.token) {
    throw redirect({ to: '/connect', search: { from: location.href } })
  }
  if (!context.session.isCreator) {
    throw redirect({ to: '/onboard' })
  }
}
```

The `/connect` route stores the `from` search parameter and redirects back after successful connection. The `/onboard` route does not store a redirect — a user who has connected but not registered as a creator has one next step: complete onboarding.

### Route file tree

```
src/routes/
├── __root.tsx            Layout with header nav, chain indicator, session provider
│
├── index.tsx             /          Landing (static) — public, no auth required
├── about.tsx             /about     What is DEN — public
├── connect.tsx           /connect   Wallet connection entry point
├── onboard.tsx           /onboard   Creator onboarding wizard
│
├── $handle.tsx           /$handle   Creator profile (public + subscriber view)
├── $handle.post.$fingerprint.tsx
│                         /$handle/post/$fingerprint   Post permalink (one post = one
│                         fingerprint, so the fingerprint is the post's stable identity).
│                         Same access rules as the profile: public posts render for anyone,
│                         paywalled posts render locked until a key is held. "Copy link to
│                         post" emits the den-spec §6.4 shareable form
│                         (den://$handle/post/$fingerprint), never an instance URL.
│
├── feed.tsx              /feed           Subscriber guard
├── subscriptions.tsx     /subscriptions  Subscriber guard
├── settings.tsx          /settings       Subscriber guard
│
└── studio/
    ├── __layout.tsx      Studio layout (side rail nav) — Creator guard on parent
    ├── index.tsx         /studio           Dashboard
    ├── post.tsx          /studio/post      New post composer
    ├── content.tsx       /studio/content   Content library
    ├── tiers.tsx         /studio/tiers     Subscription tier management
    ├── access.tsx        /studio/access    Access grant declarations
    ├── settings.tsx      /studio/settings  Handle, bio, emergency wallet
    ├── keys.tsx          /studio/keys      Key rotation stub (v1.x)
    └── migrate.tsx       /studio/migrate   Instance migration stub (v1.x)
```

The creator guard is placed on `studio/__layout.tsx`. All routes nested under `studio/` inherit it. A creator who is also a subscriber accesses studio routes via `/studio` — they do not need a separate account. The studio layout is visually distinct from the public/subscriber layout (side rail vs. top bar) as specified in DESIGN.md.

**`$handle` route resolution:** The `$handle` route param is the creator's handle or proxy address. The instance's `GET /profile/:proxy` accepts **only** proxy addresses (400 otherwise) — handle resolution is an on-chain read, not an instance call. On load: if the param matches `/^0x[0-9a-fA-F]{40}$/` it is used as the proxy directly; otherwise resolve it via `DENIdentityRegistry.resolve(handle)` (a zero-address result is the not-found case). Then call `GET /profile/:proxy` with the resolved address. All subsequent operations on the profile use the proxy address, not the handle. Alias retention for changed handles is the contract's concern — `resolve` honours the `handle_alias_retention_window` governance parameter on-chain.

---

## Section 7 — Visual Design System

**Purpose:** Define the complete CSS custom property token set that all components use. Tokens defined here are the only values that should appear in CSS Module files — no hardcoded colours, spacing values, or type sizes in component stylesheets.

**Scope:**
- Colour palette tokens and actual values
- Accent colour (one decision marked provisional)
- Spacing scale
- Typography stack and size scale
- Border radius scale
- Z-index scale
- Chain indicator colour treatment

---

### Colour palette

Defined in `src/styles/tokens.css` as `:root` custom properties.

```css
/* --- Backgrounds --- */
--color-bg:              #0f0f0f;   /* base background — near black */
--color-surface:         #181818;   /* cards, panels */
--color-surface-raised:  #222222;   /* modals, dropdowns, popovers */
--color-surface-overlay: #2a2a2a;   /* hover states on surface */

/* --- Text --- */
--color-text-primary:    #f0f0f0;   /* body copy, headings */
--color-text-secondary:  #a0a0a0;   /* metadata, secondary labels */
--color-text-tertiary:   #5a5a5a;   /* timestamps, captions, disabled states */
--color-text-inverse:    #0f0f0f;   /* text on accent background */

/* --- Borders --- */
--color-border:          #282828;   /* default dividers */
--color-border-strong:   #383838;   /* stronger separators */
--color-border-focus:    var(--color-accent);   /* focus rings */

/* --- Accent (single — primary actions and active states only) --- */
--color-accent:          #8b5cf6;   /* violet — PROVISIONAL, confirm before v1 */
--color-accent-hover:    #7c3aed;
--color-accent-subtle:   #1e1433;   /* accent-tinted surface for active states */

/* --- Feedback --- */
--color-error:           #f87171;   /* error text and icons */
--color-error-subtle:    #2d1515;   /* error-tinted surface */
--color-success:         #4ade80;   /* success text and icons */
--color-success-subtle:  #0f2a1a;   /* success-tinted surface */
--color-warning:         #fbbf24;   /* warning text and icons */

/* --- Chain indicator --- */
--color-chain-mainnet:   var(--color-accent);   /* accent = mainnet = real money */
--color-chain-testnet:   #f59e0b;               /* amber = testnet = not real */
--color-chain-dev:       #6b7280;               /* grey = local dev */
```

**On the accent colour:** Violet (`#8b5cf6`) is provisional. It was chosen as a neutral starting point — not aggressively bright, works on dark backgrounds, has sufficient contrast ratio against `--color-bg`. The final value requires a deliberate decision with community input before v1. The token structure is correct regardless of the value chosen. Change the value in `tokens.css`; every component updates automatically.

**On chain indicator treatment:** Testnet amber is intentional and should not be changed to match the brand. The amber signal must be visually distinct and slightly alarming — a user on testnet who mistakes it for mainnet would use real funds. Mainnet uses the accent colour, which is the app's native active-state colour and conveys "this is the real thing."

### Spacing scale

4px base unit.

```css
--space-1:   4px;
--space-2:   8px;
--space-3:   12px;
--space-4:   16px;
--space-5:   20px;
--space-6:   24px;
--space-8:   32px;
--space-10:  40px;
--space-12:  48px;
--space-16:  64px;
--space-20:  80px;
--space-24:  96px;
```

### Typography

```css
/* --- Font stacks --- */
--font-body: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
             Helvetica, Arial, sans-serif;
--font-mono: 'SFMono-Regular', 'SF Mono', 'Cascadia Code', 'Fira Code',
             'JetBrains Mono', 'Consolas', monospace;

/* --- Type scale --- */
--text-xs:   12px;
--text-sm:   14px;
--text-base: 16px;
--text-lg:   18px;
--text-xl:   20px;
--text-2xl:  24px;
--text-3xl:  30px;
--text-4xl:  36px;

/* --- Line heights --- */
--leading-tight:  1.25;
--leading-normal: 1.5;
--leading-relaxed:1.625;

/* --- Font weights --- */
--weight-normal:   400;
--weight-medium:   500;
--weight-semibold: 600;
--weight-bold:     700;
```

Monospace is used for proxy addresses, fingerprints, transaction hashes, and any other protocol identifiers displayed to the user. These must never render in the proportional body font — character width consistency matters for scanability of hex strings.

### Border radius

```css
--radius-sm:   4px;
--radius-md:   8px;
--radius-lg:   12px;
--radius-xl:   16px;
--radius-full: 9999px;   /* pills, badges, avatar rings */
```

### Z-index scale

```css
--z-base:    0;
--z-raised:  10;    /* sticky headers, floating labels */
--z-dropdown:20;    /* dropdowns, popovers */
--z-modal:   30;    /* dialogs, tier selection modal */
--z-overlay: 40;    /* transaction progress overlay */
--z-toast:   50;    /* session banners, error toasts */
```

---

## Section 8 — Content & Crypto Pipeline

**Purpose:** Define how content flows through the client: how keys are requested and cached, how ciphertext is decrypted for display, and how the three-phase posting pipeline operates.

**Scope:**
- Content key request and cache policy
- Decryption pipeline for subscriber content display
- Upload pipeline phases and state transitions
- Retry behaviour for each phase
- Master secret operations (creator-only)

---

### Content key request and cache policy

When a subscriber loads a creator's profile or feed, content keys are requested at the tier level, not per-post. One `POST /access/key` call covers one `(creator, tier)` pair — body `{ type: "subscription", creatorProxy, tierId }` — and the response, `{ keys: { "tier:1": "0x...", ... } }`, contains a key for **every derivation path that tier's access grant covers**. A higher tier whose grant includes lower-tier paths (e.g. tier 2 granting `["tier:1", "tier:2"]`) returns all of those keys in one call; every returned path is written to the cache, not just the requested tier. The target is one request per subscribed `(creator, tier)` per session, not one request per content item.

**Request timing:** Keys are requested after session establishment and before the content feed renders. If the key request fails (subscription lapsed, instance error), the feed renders in locked state — all paywalled cards show the locked overlay. A retry mechanism is available; the user is not left on a blank screen.

**Cache key:** `${creatorProxy}:${tierId}`. Content under the same tier shares one cached key. This matches the derivation architecture — all content under a tier is encrypted with the same derived key.

**Cache invalidation:** None within a session. The cache is cleared on session end (disconnect, page refresh). A subscription that lapses mid-session is handled by the key request failure path at next access, not by proactive cache expiry.

**Public content:** Public content posts include the `contentKey` directly in the `GET /profile/:proxy` response. These keys are stored in the content key cache using the same shape but keyed by fingerprint rather than tier, since public content is per-post — each public post carries its own random key by construction (Appendix A, "Public content keys").

**Visibility changes are re-encryption events.** A blob's key cannot be swapped after the fact, so toggling a post between paywalled and public means: re-encrypt the plaintext with the appropriate key (fresh random for public, tier key for paywalled), upload (new fingerprint), register on-chain, then delete the old row and archive the old fingerprint. The content library's visibility control is therefore a pipeline action with chain transactions, not a metadata flip — and going private again is presented honestly: the old key was published, so what was public stays disclosed.

### Decryption pipeline

For each post (card) to be displayed:

1. Check content key cache for the tier. If missing, show locked overlay.
2. `GET /content/:fingerprint` — download ciphertext bytes
3. Slice: `nonce = ciphertext[0..12]`, `ct = ciphertext[12..]`
4. `crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aesKey, ct)` → plaintext bytes
5. `parseEnvelope(plaintext)` → `{ text, images: [{ bytes, type, w, h }] }` (`src/lib/envelope.ts`)
6. Per image: create an object URL from its bytes (typed with the declared MIME) → `<img src>`. The header's `w`/`h` size each image container *before* decode, so the card's clamped aspect-ratio layout is stable from the first paint. Render `text` as plain text alongside.

Steps 2–6 happen per card. Step 2 (download) and step 4 (decrypt) run concurrently for multiple cards when a feed loads — do not serialize them. An envelope that fails validation in step 5 renders the same error card as a decryption failure — malformed framing and a wrong key are indistinguishable states to the viewer. Object URLs are revoked when the card unmounts.

**Latency handling:**
- Card shows skeleton during steps 2–4
- If step 4 takes more than 300ms, replace skeleton with a subtle inline spinner
- On step 5 completion, transition from spinner/skeleton to content in a single frame (no layout shift)
- Decryption failure (malformed ciphertext, wrong key) renders an error card with "Content could not be decrypted" and a report option — not a full-page error

### Upload pipeline (creator posting)

Three sequential phases with explicit state transitions in `usePipelineStore`.

**Phase 1 — Envelope build + local encryption** (`encrypting`)

One operation per post, not per file:
```
plaintext = buildEnvelope(text, images)               // src/lib/envelope.ts — PROTOCOL.md §Post envelope
key       = HKDF-SHA256(masterSecret, "tier:" + tierId)   // paywalled: tier-derived
          | crypto.getRandomValues(32 bytes)              // public: fresh random per-post key
nonce     = crypto.getRandomValues(12 bytes)
ct        = AES-256-GCM.encrypt(key, nonce, plaintext)
blob      = concat(nonce, ct)
```

Before encrypting, the composer checks `plaintext.length + 28 ≤ post_size_limit(trustTier)` — the only size constraint the protocol enforces is total blob bytes. Per-file caps and the maximum image count are composer policy (v1: 10 images per post, a plain constant).

Public posts are never encrypted with a derived key — the key is published in the profile, and a published tier key would unlock the whole tier (Appendix A, "Public content keys"). Public posts upload with `X-Tier-Id: 0` (reserved; real tiers number from 1) and supply the random key to the visibility endpoint after registration.

All envelope assembly and encryption runs on the main thread in v1. Web Worker extraction is a v1.x improvement — the single `Uint8Array` blob transfers to a Worker as a `Transferable` with zero copies when the time comes.

Phase 1 has no network dependency. If Phase 1 fails (e.g. memory pressure on a large post), the error surfaces in the pipeline store and the user can retry from the composer without data loss — the original files are still in the file input.

**Phase 2 — Upload** (`uploading`)

```
POST /creator/content
Headers: X-Tier-Id: {tierId}, X-Warnings: {warnings}
Body: ciphertext bytes
→ { fingerprint: "0x..." }
```

Upload progress is tracked by XHR `progress` events (fetch does not expose upload progress; use XMLHttpRequest for this request only). Progress is reported to the pipeline store for display.

On network failure: the encrypted blobs remain in `usePipelineStore`. The user sees "Upload failed. Your content was encrypted locally — retry the upload without encrypting again." Retry re-sends the bytes already in the pipeline store.

On completion: `fingerprint` is stored in `usePipelineStore`. Phase 3 can begin.

**Phase 3 — On-chain registration** (`registering`)

Two sub-steps using the standard three-step transaction progress component:

Sub-step A: `DENContentRegistry.registerContent(fingerprint, tierId)`

Sub-step B: Access grant update — only if the tier's grant needs to be created or updated (new tier, or path change). This is a second transaction (`DENAccessGrant.publishGrant(tierId, paths, sig)`). Both sub-steps use the same transaction progress component, shown sequentially.

On chain tx failure: the ciphertext is already uploaded and the fingerprint is known. The user sees "On-chain registration failed. Your content was uploaded but won't be accessible until registration completes. [Retry]". Retry fires only Phase 3 using the fingerprint already in the pipeline store.

On completion: `usePipelineStore.clear()` is called. The encrypted blobs are released from memory. The post is live.

---

## Section 9 — Client-Side On-Chain Indexing

**Purpose:** Define how furden assembles subscriber-facing views — the subscriptions list and the content feed — from on-chain event logs, because the instance exposes no aggregation endpoints. Define the single-instance boundary for v1 and how it is enforced without ever showing a subscriber a broken-subscription screen.

**Scope:**
- Why the client reads chain events directly
- Subscription enumeration via the `Subscribed` event
- Authoritative subscription expiry via contract read
- Creator → instance resolution and the single-instance boundary
- The `/feed` assembly pipeline
- `getLogs` range strategy and RPC constraints
- Ownership: TanStack Query, not Zustand

---

**The instance is not an index.** A DEN instance stores ciphertext and gates keys against live on-chain state. It has no endpoint that lists which creators a wallet subscribes to, no trending query, and no cross-creator feed. It mirrors a subscription locally only as a side effect of a key request (PROTOCOL.md §Key delivery), so its local view is incomplete and non-authoritative. The canonical record of a subscriber's subscriptions lives on-chain in `DENSubscription`. furden reads it there directly. This is not a workaround for a missing endpoint — on-chain is the source of truth, and it is the only source that survives a subscriber holding subscriptions across more than one instance.

**Subscription enumeration.** The `Subscribed(subscriberProxy indexed, creatorProxy indexed, tierId indexed, expiresAt)` event is the entry point. A single `getLogs` filtered on the indexed `subscriberProxy` topic returns every subscription the connected wallet's proxy holds, each carrying its `creatorProxy`, `tierId`, and `expiresAt` inline. This one query is the backbone of both `/subscriptions` and `/feed`:

- A re-subscribe (calling `subscribe()` again) emits a fresh `Subscribed` event. Dedupe the log set by `(creatorProxy, tierId)`, keeping the entry from the highest block.
- The set of distinct `creatorProxy` values is the creator list for the feed.

**Expiry is read live, not trusted from the event.** The `expiresAt` in a `Subscribed` log is correct as of the moment of that subscription, but the authoritative current expiry is whatever `DENSubscription.getSubscriptionExpiry(subscriberProxy, creatorProxy, tierId)` returns now. `/subscriptions` uses events for discovery (which subscriptions exist) and a contract read per subscription for current state — active / expiring soon / expired, and the renewal date. This mirrors the instance's own philosophy: on-chain is the authority, and access-relevant state is never cached past the moment it matters.

**Creator → instance resolution and the single-instance boundary.** Each `creatorProxy` resolves to a home instance URL recorded on-chain — read `instanceURL()` at the proxy address. It is written by `DENIdentityImpl.updateInstanceURL(url, receivingInstanceProxy, instanceSig)`, which requires a countersignature from the receiving instance's primary wallet; the client fetches it from `GET /creator/url-signature` during creator onboarding (PROTOCOL.md step 7). furden routes every per-creator operation — profile fetch, content listing, key request, ciphertext download — to the creator's resolved instance URL, not to a single global base URL.

In v1, furden renders content only for creators whose resolved instance URL equals `VITE_INSTANCE_URL`. A subscription to a creator hosted elsewhere is **not** an error and never produces a broken-subscription screen. On `/subscriptions` it renders as an honest link-out — "Hosted on another DEN site → Open" — linking to that creator's instance. This is the single-instance scope decision (Appendix A; DESIGN.md) made concrete.

The discipline that keeps multi-instance a future flip rather than a rewrite: route by the resolved instance URL from the first line of code. v1 asserts `resolved === VITE_INSTANCE_URL` and link-outs otherwise. Enabling cross-instance feeds later means removing that assertion and authenticating a session per instance — not re-plumbing how creators are addressed.

**The `/feed` assembly pipeline.**

1. **Enumerate** — one `getLogs` on `Subscribed` by `subscriberProxy` → the `(creatorProxy, tierId, expiresAt)` set. [one chain query]
2. **Resolve & filter** — resolve each `creatorProxy` to its instance URL; keep those equal to `VITE_INSTANCE_URL`; the rest are link-outs surfaced only on `/subscriptions`, not in the feed.
3. **Fetch per (creator, tier)** — for each retained pair, in parallel: `GET /content/by-creator/:creatorProxy?tierId=` (inventory) and `POST /access/key` (the tier key). The content list and key request are the two siblings of the same per-tier entitlement model (Section 8).
4. **Merge & decrypt** — concatenate all inventory items, sort by `timestamp` (Unix ms) descending, and decrypt each card's ciphertext as it downloads (Section 8 decryption pipeline). The feed renders progressively; a single creator's instance being slow or down degrades to a skeleton for that creator's cards, not a failed feed.

A single creator's profile (DESIGN.md Flow 5) is the same pipeline scoped to one `creatorProxy`: list the tiers the viewer holds, fetch inventory + keys for those, and render locked teasers for tiers they do not hold (from the public profile's tier cards and warned-content metadata).

**`getLogs` range strategy.** `fromBlock` is the contract's deployment block — a per-chain constant in `src/lib/chain.ts`, never `0` — so the query does not scan pre-deployment history. Public Base RPC endpoints may cap the block range of a single `getLogs`; when a full-range query is rejected, furden chunks the range into fixed windows and concatenates results. The `Subscribed` filter is indexed on `subscriberProxy`, so the matched-log volume is small (one wallet's own subscriptions) even when the scanned range is large. If public-RPC log latency becomes a launch problem, the mitigation is a dedicated RPC or a light indexer — not a protocol change; this pipeline is unchanged by where the logs come from.

**Ownership.** All of this is server state and lives in TanStack Query — keyed by `subscriberProxy` for the enumeration and by `creatorProxy` for resolution and profiles. The creator → instance-URL resolution is cacheable for the governance `resolver_cache_ttl` window. None of it belongs in Zustand: it is fetched, cached, and invalidated, not imperatively mutated. The enumeration query is invalidated when this session broadcasts a new `subscribe()` transaction, so a just-subscribed creator appears without a manual refresh.

---

## Appendix A — Resolved Decisions

A record of architectural decisions that were considered, evaluated, and resolved. Maintained here so future discussions have context for what was already worked through.

---

**React 19 over Vue 3 and Svelte 5**

React 19 was chosen. wagmi is React-first — Vue and Svelte have adapters, but React receives new features and the most maintained integration. The largest web3 contributor pool knows React. React 19's compiler reduces re-render cost on crypto-heavy state updates. Svelte had no official wagmi adapter at decision time.

**TanStack Router over React Router v7**

TanStack Router was chosen for type-safe route params. Proxy addresses and fingerprints appear in URLs and are security-meaningful identifiers. TanStack Router types them end-to-end; React Router treats params as `string`. Making type errors at the route boundary a build error rather than a silent runtime misdirection is the correct choice for a security-sensitive application.

**CSS Modules + CSS custom properties over Tailwind CSS**

CSS Modules with custom properties was chosen. The design direction is specific and content-forward — the UI chrome recedes and creator art is primary. Tailwind's utility model produces the most value for dashboard and form-heavy UIs built to a generic design system. The custom properties approach gives complete control over the precise token set, pairs natively with Radix UI data-state attributes, and adds no PostCSS dependency.

**Radix UI over Ark UI**

Radix UI was chosen. Both are headless accessible primitive libraries. Radix is more established, has a larger community, and the specific components needed (Dialog, DropdownMenu, Progress, Tabs, Checkbox, Tooltip) are all mature and well-documented. Ark UI had no compelling advantage over Radix for the specific use case.

**Separate stores over a single Zustand store with slices**

Separate stores were chosen. The primary reason is that `useCryptoStore` must have Redux DevTools disabled — the master secret must not appear in any devtools inspector. A single store cannot have devtools selectively disabled. Separate stores also produce more granular re-render subscriptions: a component that only needs the session token does not re-render on content key cache updates.

**Vendored ABIs over a workspace package dependency**

Contract ABIs are vendored into `src/lib/abis.ts` rather than imported from `den-protocol` via a workspace or `file:` dependency. The source of truth is `den-protocol/abis.ts` — copy from there when the protocol contracts change. The protocol is stable. den-protocol and furden are separate repositories. Requiring contributors to clone both repos to run `pnpm install` on the client is unnecessary friction. If the protocol contracts change, `src/lib/abis.ts` is updated as part of the same PR. The drift risk is accepted and managed by process, not by build tooling.

**Compile-time contract addresses over instance-fetched configuration**

Contract addresses are constants per chain in `src/lib/chain.ts` rather than fetched from the instance at startup. The DEN protocol contracts are a single canonical deployment per chain — they are not per-instance configuration. Fetching them from the instance adds a startup network dependency and failure mode for no benefit at v1 scope. Development overrides are available via env vars when running against local Anvil.

**No pre-built wallet connection modal (RainbowKit, Web3Modal)**

Pre-built connection modals were rejected. Both impose visual constraints incompatible with furden's design direction and bundle styling that conflicts with the CSS Modules approach. The wallet connection UI is built on wagmi primitives with a Radix Dialog. The additional implementation effort is bounded and the visual control is complete.

**Plain text over rich text for posts**

Plain text was chosen for v1. Markdown adds a parser dependency and requires HTML sanitisation to prevent XSS when rendering. The safety and simplicity case outweighs the formatting benefit at launch. Markdown rendering is a v1.x addition once the core posting pipeline is validated.

**Static landing page for `/` — no instance-backed discovery**

The instance has no discovery API — no endpoint for listing creators, no trending query, no curated feed. `/` cannot be backed by server-side discovery queries. `/` is a static landing page for v1 explaining what DEN is, optionally with a hand-curated (hardcoded, not API-backed) creator list. There is no `/explore` route in v1 — see the dedicated entry below. This is consistent with den-architecture.md §6: DEN is a destination after discovery happens elsewhere, not a discovery platform.

**Images only — no file attachments (v1)**

The protocol is format-agnostic at the storage layer; `POST /creator/content` takes raw ciphertext bytes with no content-type metadata. The UI decision was whether to support ZIP art packs as a distinct content type. Images only for v1. ZIPs require a second complete card variant for the feed (download button vs. inline display) and separate handling in the upload pipeline. That scope cost is not justified when images cover the primary community use case. Art pack support is v1.x.

**Clamped natural aspect ratio for content cards**

Content cards render at the image's natural aspect ratio, clamped to a min/max range to prevent excessively tall or wide images from dominating the feed:

- Minimum: **2:3** (portrait cap)
- Maximum: **4:3** (landscape cap)
- At clamp boundaries: `object-fit: contain` — letterbox rather than crop, preserving the artist's composition

Within the range the image renders at its true ratio with no cropping. Clamping is a layout concern, not an artistic one: the choice of contain over cover at the boundary is what makes clamping respectful of the work.

**All three subscription renewal detection strategies combined**

Subscription expiry detection is pull-based. All three available signals are used together:
1. On page load — check subscription state for active subscriptions
2. On feed load — re-verify before rendering the feed
3. On key request failure — a failed `POST /access/key` surfaces a renewal CTA immediately

These signals are complementary, not alternatives.

**Manifesto voice for all UI copy**

Error messages, empty states, and system copy use the manifesto voice: direct, first-person, without corporate hedging. Consistency across the app is the priority; the manifesto voice is the correct choice for a project with a strong community identity document. "Your content is encrypted here, in your browser" is the register; all copy matches it.

**Accent colour — provisional until visual review**

`#8b5cf6` (violet) is confirmed as the working value in `--color-accent`. It is not blocked: the token structure is correct and all components use the token. The value is reviewed and confirmed or updated before v1 ship. No component code changes when the value changes — it is a single line in `tokens.css`.

**Single-instance subscriber scope for v1**

The subscriber's active experience — browse, feed, view, subscribe — is scoped to the one configured `VITE_INSTANCE_URL`. A creator hosted on a different instance is not rendered inline; on `/subscriptions` such a subscription appears as an honest link-out to that creator's instance, never a broken-subscription error. The rejected alternative was full multi-instance support in v1: resolving each creator's instance from chain and authenticating a separate session per instance. That is a real subsystem (per-instance auth means a wallet signature per instance — friction that cannot be hidden), not a flag, and the unified cross-instance feed it enables is a v1.x goal. The decision was reasoned from UX first: discovery is off-platform, so subscribers arrive at a creator via that creator's own link, which already points at the creator's home instance; the only thing wanting multi-instance is a unified cross-creator feed. The extensibility hedge — route everything by the creator's chain-resolved instance URL from day one and merely assert equality in v1 — makes the later switch a removal of that assertion, not a rewrite. See Section 9.

**Client-side on-chain indexing over instance aggregation endpoints**

Subscriber views are assembled from contract event logs (`Subscribed`, `ContentRegistered`), not from instance aggregation endpoints, because the instance is a ciphertext store and key gate, not an index — it has no authoritative list of a wallet's subscriptions. The rejected alternative was pushing subscription/feed indexing into the instance; that would make the instance a chain indexer and still could not see subscriptions to creators on other instances. On-chain enumeration is the only source of truth that works across instances. The one place the instance *is* the right source — listing a creator's content for a tier the subscriber holds — is served by `GET /content/by-creator/:proxy?tierId=` (Section 8, PROTOCOL.md), because the instance already holds that data and on-chain `ContentRegistered` events would be the slower, chattier path on the hot feed load. See Section 9.

**Subscription price display — native amount always, approximate USD from Chainlink on-chain feeds**

Prices render in their native token amount at all times (e.g. "5 USDC / month", "0.01 ETH / month") — that is the on-chain source of truth and the amount actually charged. Alongside it, an approximate fiat figure ("~$5") is shown as a comprehension aid, read from a **Chainlink price feed on Base** via viem and cached via TanStack Query. The fiat figure carries a leading "~" and never implies the charge is denominated in fiat.

The source is Chainlink, not a centralized price API, to satisfy den-spec §3.5 ("exchange rates for display SHOULD use Chainlink price feeds or equivalent decentralized price oracles") and to stay consistent with furden's own anti-centralization decisions elsewhere (rejected RainbowKit, rejected instance-fetched config, rejected a token allowlist). A centralized HTTP price API (e.g. CoinGecko) was **rejected** for this path on two grounds beyond the §3.5 SHOULD: it is a centralized chokepoint that can rate-limit, geoblock, or disappear; and querying it by token contract on every profile view leaks a user's browsing pattern to a third party — unacceptable in an E2EE privacy app (cf. den-spec §2.6). Reading Chainlink on-chain is the *same* viem read pattern furden already uses for ERC-20 `symbol()`/`decimals()`, so it adds no new dependency class.

Mechanism: a small built-in registry maps token contract addresses (and the `address(0)`=ETH sentinel) to their Chainlink aggregator addresses on Base, covering ETH and the common stablecoins (USDC, DAI, USDT). The accepted cost of decentralization here is coverage: Chainlink does not have a feed for every token a creator might price in. **A token with no known feed simply shows no fiat figure — omitted entirely and silently, with no fallback to a centralized API.** The native amount (always shown) remains fully correct; only the optional "~$" helper is absent. This is the deliberate tradeoff chosen over CoinGecko's broader coverage: spec compliance, no centralized dependency, and no privacy leak outweigh a fiat hint on long-tail tokens.

Rejected alternatives: USD-only (misrepresents a crypto-native charge); native-only (the personas — River is crypto-new — need a price anchor to judge whether a subscription is worth it); CoinGecko/centralized API (above). No required configuration; graceful degradation when a feed read fails or no feed exists. See Section 3, "Token metadata and price display." Resolved 2026-06-17 — supersedes the earlier CoinGecko choice after cross-checking den-spec §3.5.

**Creator avatars — deterministic identicon from the proxy address (v1)**

v1 derives each creator's avatar deterministically from their proxy address (a jazzicon/blockies-style identicon). Zero infrastructure, no upload pipeline, and every creator gets a stable, recognisable mark from day one with no fallback-blank case. **Custom avatar / profile-image upload is explicitly out of scope for v1.** The instance API has no avatar field and no avatar storage, so real uploads require a new instance endpoint — that is a v1.x instance-side change, not a client-only one, and is deliberately deferred.

**Instance display name — `VITE_INSTANCE_NAME` env var (v1)**

Attribution copy ("Hosted on [name]", "You're connected to [name]") reads from a build-time `VITE_INSTANCE_NAME` env var set by the operator. If unset, furden falls back to the host portion of `VITE_INSTANCE_URL`, so the label is never blank. Rejected for v1: a `GET /info` instance metadata endpoint — operator-authoritative and nicer, but it is another instance change and a startup dependency for a cosmetic label. Revisit `/info` when the instance grows a metadata surface. The env var is the mechanism; the hostname fallback is defensive, not a second source.

**Token symbol & decimals — on-chain ERC-20 reads**

Tier pricing carries only a token contract address. furden renders human amounts by reading ERC-20 `symbol()` and `decimals()` on-chain via viem, caching per token (both immutable), with `address(0)` rendered as "ETH" (18 decimals, no contract call). Rejected: a hardcoded known-token allowlist — it silently breaks for any token a creator legitimately chooses outside the list, while the on-chain read is a few lines and is the correct source. See Section 3, "Token metadata and price display."

**`/explore` — removed from v1**

There is no `/explore` route in v1. The instance exposes no discovery API (no creator listing, no trending query), so a browse surface cannot be backed by instance queries (consistent with "Static landing page for `/`" above). `/` is the static landing page and the header carries no Explore link. The DESIGN.md IA route structure and nav model are reconciled to match — their earlier "Browse creators" / "Discover — trending creators" wording was stale relative to the resolved decision. A curated or community-maintained browse surface, if wanted, is a later addition and does not block v1.

**isCreator — operational blob existence, not registry registration**

`isCreator` is set from `GET /creator/blob` → `{ exists }` on the configured instance after session establishment. The rejected derivation was `DENIdentityRegistry.isRegistered(walletAddress)`: registration is universal — subscribers must register before they can authenticate at all — so that read is true for every authenticated session and gates nothing. Operational-blob existence is the protocol's own definition of "creator setup complete on this instance": it is what key delivery requires (`POST /access/key` returns 503 without it), it flips true at exactly the onboarding step where the studio becomes usable, and it is instance-scoped — a creator hosted elsewhere correctly reads `false` here, because their studio lives on their home instance. Resolved 2026-06-11.

**Shop / one-time purchases — out of scope for v1**

The protocol and instance already carry one-time purchase support (`DENPurchaseState`, `POST /access/key` with `type: "purchase"`, `"item:<id>"` derivation paths). furden v1 implements subscriptions only; no listing management in the studio, no purchase flow, no `item:` key requests. The contract surface is stable, so adding the shop in v1.x is additive client work, not a protocol change. Recorded 2026-06-11 so the omission reads as a decision, not an oversight.

**Post envelope — one post, one blob, length-prefixed binary container with a JSON header**

A post (text + images) serialises into a single plaintext envelope encrypted as one blob: `"DENP"` magic, version byte, uint32 header length, UTF-8 JSON header (text, image manifest with `len`/`type`/`w`/`h`), then raw image bytes in manifest order. Normative definition in PROTOCOL.md §Post envelope. One post = one fingerprint = one `registerContent` transaction = one rate-limit unit = one size budget — which is what the governance parameter (`post_size_limits`) and the composer copy already meant by "post". The fingerprint becomes the post's stable identity (permalinks). Per-file caps and the image count cap (v1: 10) are composer policy; the instance enforces only total blob bytes and cannot see inside the envelope — file count and per-image sizes stay hidden from the hoster, which is a feature. Header `w`/`h` lets cards lay out at the correct clamped aspect ratio before image decode. Warnings stay *outside* the envelope (instance metadata) because teaser cards must render them without the key.

Rejected: **per-image blobs** (no home for post text, N wallet confirmations and N rate-limit units per post, leaks image count/sizes to the hoster, and one "post" could consume N× the post size limit); **JSON with base64 images** (~33% size-budget inflation); **CBOR container** (fine format, but adds a runtime dependency to the content-decryption path that is otherwise only `@noble/*` + Web Crypto, for ~60 lines of saved parsing). Accepted costs: a post renders only after the whole blob downloads and decrypts (no per-image lazy loading or thumbnails), and editing any part of a post is a new blob, new fingerprint, new registration. Resolved 2026-06-11.

**Public content keys — fresh random per-post key, never tier-derived**

The `contentKey` published for a public post is a fresh random 32-byte key generated at encryption time. The rejected (and previously documented) alternative — supplying `deriveKey(masterSecret, "tier:" + tierId)` — is a tier-wide confidentiality break: registration is permissionless, `GET /content/:fingerprint` serves private ciphertext on authentication alone, and paywalled fingerprints are enumerable from on-chain `ContentRegistered` events, so one public post would hand every authenticated participant the key to all of that tier's paywalled content, permanently. The instance stores whatever key it is given and cannot verify derivation — the discipline is the client's. Consequences accepted with the decision: public posts upload under reserved `X-Tier-Id: 0` (real tiers number from 1), and visibility toggles are re-encryption events (new blob, new fingerprint, new registration) rather than metadata flips, with honest copy that returning a post to paywalled does not un-publish what was public. No instance or contract change required. Resolved 2026-06-11.

**Portability-blob recovery — emergency wallet is the path, copy stays honest**

Onboarding presents the **emergency wallet** as the recovery path — the protocol-native mechanism: a second registered wallet receives its own emergency portability blob, decryptable by that wallet. Onboarding does **not** promise one-click in-app key recovery, because in-browser decryption of a portability blob needs a private key an injected wallet never exposes (PROTOCOL.md onboarding step 5). The copy states plainly that registering an emergency wallet is the backup path and that fuller recovery/migration tooling arrives in v1.x. Rejected as the sole answer: a seed-phrase backup prompt — that conflates wallet custody (the wallet's own responsibility) with DEN key recovery; onboarding may still remind users their wallet is their key, as DESIGN.md Flow 2 Step 1 already does, but that is not a substitute for the emergency-wallet path.

---

## Appendix B — Open Questions and Task Queue

Reopened 2026-07-01 after the first live browser end-to-end run (anvil + instance + two MetaMask wallets). The arc validated cleanly — creator onboard → tier → public + paywalled post → subscriber subscribe → paywalled decrypt in feed, including the instance's checksummed-proxy key-delivery fix — but the run surfaced real defects, UX gaps, and a friction problem that drove a protocol-level plan. This is the standing task queue; work top-down. Reasoning from the run is recorded inline so the "why" survives.

### 1. Standalone furden fixes — DONE 2026-07-02 (compiler-verified; live re-test pending)

All five shipped in one batch; each was furden-only.

- ~~**Composer stuck on "posted successfully" (bug).**~~ Fixed: `/studio/post` clears a leftover `done` pipeline on mount (error/mid-pipeline states are kept — they carry the resumable output the store exists to preserve). The in-page "Write another" reset already existed.
- ~~**Tier price shows no token symbol (bug).**~~ Fixed: the create-tier form resolves token meta as the address is typed (blank = ETH), names the unit in the price label, echoes `— {price} {SYMBOL} / {days} days` in the submit button, and rejects invalid/unreadable token addresses inline.
- ~~**Repeat-subscribe has no guard (bug).**~~ Fixed: new `readSubscriptionStatus(wallet, creator, tierId)` in `lib/subscribe.ts` (wallet → proxy → live `getSubscriptionExpiry`; same active test as the feed). An active holder sees "Subscribed · until {date}" and the action relabels **Extend**, with dialog copy stating that paying again adds duration on top. (Copy says "until", not "renews" — nothing auto-renews.)
- ~~**Public posts absent from the feed (gap).**~~ Fixed: `assembleFeed` now also fetches each subscribed on-instance creator's public profile and merges `publicContent` (keys ship in the profile) into the feed; distinct creators are resolved to the instance once, and fingerprint dedupe covers both sources.
- ~~**No handle nudge after onboarding (gap).**~~ Fixed: the wizard gained a sixth, explicitly optional "Pick a handle" step (reuses `lib/settings.setHandle` + `lib/resolve.readHandle`) with a "Skip — stay handleless" action; copy states that a handleless profile still resolves by address. Completion is skip-or-set, since `handleOf` returning `""` is a valid final state.

### 2. Friction reduction — furden's part, ordered per den-protocol Appendix C (L0 → L2 → L1 → L3)

The full plan and reasoning live in `den-protocol/spec/den-architecture.md` Appendix C and the normative tracker in `den-protocol/spec/den-spec.md` Appendix C. *From the run: too many wallet prompts, and — worse — a subscriber must pay a `register()` tx to exist before subscribing (the ETH-prerequisite barrier). On Base the gas amount is cents; the barrier is the prompts and the prerequisite.* furden's slices:

- ~~**L0 — signature merge (furden-only).**~~ DONE 2026-07-02. `signIn` recovers the wallet pubkey from the sign-in signature it already holds (`pubKeyFromSignature` in `lib/crypto.ts`) and caches it in the crypto store (session-scoped, cleared with everything else); `provisionCreatorKeys` uses it and only falls back to the dedicated prompt when the capture is missing. Guarded: the recovered address must match the wallet before the pubkey is trusted — encrypting the portability blob to a mis-recovered key (e.g. a contract wallet's non-recoverable sig) would be silent data loss.
- **L2 follow-on (when den-protocol implicit-default-grants lands).** Make `ensureAccessGrant` a no-op for default `["tier:N"]` grants; only sign/publish for cumulative tiers. Removes the grant signature + `publishGrant` tx from the first paywalled post.
- **L1 follow-on (when CREATE2 lazy-deploy lands).** Collapse the onboarding/subscribe flows: a subscriber's `register()` folds into `subscribe()` (one tx); the creator proxy deploys on first real action. Update the onboarding wizard's derived-stage logic and the subscribe step machine.
- **L3 follow-on (when AA + paymaster lands).** Route writes as sponsored `UserOperation`s (4337) or via a 7702-delegated EOA so users need no gas token and prompts collapse to one-per-intent. Reworks the wagmi connector/transaction path; largest furden change, last.

### 3. Deferred → Phase C (product polish)

- ~~**Landing page has no links to relevant pages.**~~ DONE 2026-07-02. `/` is now a real landing page (hero + two path cards + about pointer, manifesto voice): a creator-lookup form (handle or 0x address → `/$handle` — the "you arrive with their name" entry point), session-aware links (signed out: Connect with `from=/feed`; signed in: Feed + Subscriptions; `isCreator`: Open your studio, else Set up your studio → `/onboard`). `/about` is real prose (why DEN exists, the three-participant split, browser-side crypto) ending in the same entry points + an external protocol-repo link. Connecting from `/` now lands back on a page with somewhere to go.
- **Subscriber-aware creator profile.** `/$handle` only renders the public profile; a subscriber sees a creator's unlocked paywalled posts only in the aggregate feed, not on the creator's own page. Add an authenticated per-tier fetch inline (a single-creator feed) for viewers who hold a tier. *Moderate new feature, not a bug — the content is accessible in the feed.*

*Keep this section honest: it has claimed emptiness while gaps existed before. An empty Appendix B is a prompt to re-audit, not proof of completeness.*

---

*furden — Architecture Document v0.1*
*Companion to DESIGN.md (product/UX) and PROTOCOL.md (crypto/API contract)*
*Decisions recorded here are not open for revision without deliberate discussion.*
