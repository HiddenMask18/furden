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

**Content key** — a 32-byte AES-256-GCM key derived from the master secret via `HKDF-SHA256(ikm=masterSecret, salt=none, info=path)`. Unique per tier derivation path (e.g. `"tier:1"`). For subscribers: returned by the instance at `POST /access/key` — the instance derives the key server-side. For creators making content public: derived client-side to supply the `contentKey` field.

**Fingerprint** — the SHA-256 hash of a content blob's ciphertext bytes, computed server-side by the instance after upload (`POST /creator/content`). The client does not know the fingerprint before the upload completes. On-chain registration (`DENContentRegistry.registerContent`) requires the fingerprint returned by the upload response.

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
  isCreator:     boolean         // true if proxy has a registered DEN identity
  setSession:    (token: string, proxy: Address, walletAddress: Address) => void
  setIsCreator:  (v: boolean) => void
  clearSession:  () => void
}
```

`clearSession` is called on wallet disconnect and on any 401 response from the instance. It sets all fields to null/false. The UI transitions to unauthenticated state immediately — no pending requests are aborted; they will fail with the next API call and surface the reconnect banner.

`isCreator` is derived from an on-chain read (`DENIdentityRegistry.isRegistered(walletAddress)`) after session establishment. It is not derived from the session token, which only authenticates the wallet — it does not imply a registered creator identity.

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
  encryptedBlobs:  Map<string, Uint8Array> | null  // filename → encrypted bytes
  fingerprint:     string | null                    // returned after upload
  tierId:          number | null
  error:           PipelineError | null
  startEncryption: (tierId: number) => void
  setEncrypted:    (blobs: Map<string, Uint8Array>) => void
  setFingerprint:  (fp: string) => void
  setPhase:        (phase: PipelineStore['phase']) => void
  setError:        (err: PipelineError) => void
  clear:           () => void
}
```

**`encryptedBlobs` lifecycle:** Set after Phase 1 (local encryption) completes. Held through Phase 2 (upload) so the upload can be retried without re-encrypting if the network fails. Cleared after Phase 3 (on-chain registration) succeeds or on explicit `clear()`. Not cleared on Phase 2 failure — the retry path depends on it.

**Design rationale:** The encrypted blobs can be large (multiple megabytes for image posts). Storing them in Zustand means they live in the JS heap alongside the rest of the store. This is intentional — they are not written to disk and they are cleared as soon as the post succeeds. The alternative (Web Worker with postMessage) is deferred to v1.x per DESIGN.md.

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
- Fire `DENIdentityRegistry.isRegistered(walletAddress)` read to set `isCreator`
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
├── index.tsx             /          Discover — public, no auth required
├── explore.tsx           /explore   Browse creators — public
├── about.tsx             /about     What is DEN — public
├── connect.tsx           /connect   Wallet connection entry point
├── onboard.tsx           /onboard   Creator onboarding wizard
│
├── $handle.tsx           /$handle   Creator profile (public + subscriber view)
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

**`$handle` route resolution:** The `$handle` route param is the creator's handle or proxy address. On load, `GET /profile/:handle` is called, which returns the proxy address. All subsequent operations on the profile use the proxy address, not the handle. If the handle is already a proxy address (`0x...`), the API handles it identically.

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

When a subscriber loads a creator's profile or feed, content keys are requested at the tier level, not per-post. A single `POST /access/key` call returns all keys for all tiers the subscriber is entitled to. One request per creator per session is the target, not one request per content item.

**Request timing:** Keys are requested after session establishment and before the content feed renders. If the key request fails (subscription lapsed, instance error), the feed renders in locked state — all paywalled cards show the locked overlay. A retry mechanism is available; the user is not left on a blank screen.

**Cache key:** `${creatorProxy}:${tierId}`. Content under the same tier shares one cached key. This matches the derivation architecture — all content under a tier is encrypted with the same derived key.

**Cache invalidation:** None within a session. The cache is cleared on session end (disconnect, page refresh). A subscription that lapses mid-session is handled by the key request failure path at next access, not by proactive cache expiry.

**Public content:** Public content posts include the `contentKey` directly in the `GET /profile/:proxy` response. These keys are stored in the content key cache using the same shape but keyed by fingerprint rather than tier, since public content is per-post.

### Decryption pipeline

For each content item to be displayed:

1. Check content key cache for the tier. If missing, show locked overlay.
2. `GET /content/:fingerprint` — download ciphertext bytes
3. Slice: `nonce = ciphertext[0..12]`, `ct = ciphertext[12..]`
4. `crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aesKey, ct)` → plaintext bytes
5. Create object URL from plaintext bytes → set as `<img src>`

Steps 2–5 happen per card. Step 2 (download) and step 4 (decrypt) run concurrently for multiple cards when a feed loads — do not serialize them.

**Latency handling:**
- Card shows skeleton during steps 2–4
- If step 4 takes more than 300ms, replace skeleton with a subtle inline spinner
- On step 5 completion, transition from spinner/skeleton to content in a single frame (no layout shift)
- Decryption failure (malformed ciphertext, wrong key) renders an error card with "Content could not be decrypted" and a report option — not a full-page error

### Upload pipeline (creator posting)

Three sequential phases with explicit state transitions in `usePipelineStore`.

**Phase 1 — Local encryption** (`encrypting`)

For each file:
```
tierKey = HKDF-SHA256(masterSecret, "tier:" + tierId)
nonce   = crypto.getRandomValues(12 bytes)
ct      = AES-256-GCM.encrypt(tierKey, nonce, plaintext)
blob    = concat(nonce, ct)
```

All encryption runs on the main thread in v1. Web Worker extraction is a v1.x improvement — the pipeline store's `Map<filename, Uint8Array>` shape is designed to transfer cleanly to a Worker via `Transferable` when the time comes.

Phase 1 has no network dependency. If Phase 1 fails (e.g. memory pressure on a large file), the error surfaces in the pipeline store and the user can retry from the composer without data loss — the original files are still in the file input.

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

The instance has no discovery API — no endpoint for listing creators, no trending query, no curated feed. `/` cannot be backed by server-side discovery queries. `/` is a static landing page for v1 explaining what DEN is, with a community-maintained or curated creator list. `/explore` is deferred. This is consistent with den-architecture.md §6: DEN is a destination after discovery happens elsewhere, not a discovery platform.

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

---

## Appendix B — Open Questions

No open questions. All decisions recorded in Appendix A.

---

*furden — Architecture Document v0.1*
*Companion to DESIGN.md (product/UX) and PROTOCOL.md (crypto/API contract)*
*Decisions recorded here are not open for revision without deliberate discussion.*
