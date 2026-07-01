# furden

> **Status: pre-implementation.** The design spec, platform strategy, and software stack are settled. No code exists yet. See [DESIGN.md](./DESIGN.md) for the full product and UX spec. See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to participate at this stage.

The reference client for the [DEN protocol](https://github.com/HiddenMask18/den-protocol) — a web application for both creators and subscribers. Handles wallet connection, client-side encryption, on-chain transactions, and content decryption locally in the browser.

The protocol's security properties depend on this client doing the cryptography correctly. The master secret is generated here, encrypted here, and never leaves this process in plaintext. See [PROTOCOL.md](./PROTOCOL.md) for the full cryptographic contract between this client and a DEN instance.

## What this client does

**Creator flow:** register a DEN identity on-chain, generate a master secret, encrypt and upload it to an instance, post encrypted content, publish access grant declarations, rotate keys, and migrate between instances.

**Subscriber flow:** browse public creator profiles without an account, connect a wallet, subscribe on-chain, request content keys from the instance, and decrypt content locally.

Both flows run entirely in the browser. The master secret lives in memory during the session only — it is never written to disk, localStorage, or transmitted anywhere in plaintext.

## Platform

furden is a web application.

- **No app store gatekeeping.** Mobile app stores (Apple, Google) are exactly the kind of platform intermediary DEN is built to route around. A mobile-first client recreates the structural dependency the protocol was designed to eliminate.
- **Self-hostable.** Any operator or community member can serve furden themselves. The AGPL license means any fork run as a hosted service must open source its changes.
- **Auditable.** The spec's auditability requirement (§2.6.3) applies to any client offering email recovery — open source code is how that constraint is verifiable. Anyone can confirm the master secret never leaves the device.
- **Contributor accessible.** A browser-based SPA is the lowest barrier to contribution. Desktop-only or mobile-only narrows the contributor pool significantly for a project that needs UI, wallet, and crypto work simultaneously.

**Viewport strategy:** creator flows are designed for desktop (complex multi-step onboarding, local file encryption, studio management). Subscriber flows — browsing, subscribing, consuming content — are responsive and must work on mobile from day one.

A [Tauri](https://tauri.app) desktop wrapper is a natural next step for users who want a locally-installed client without CDN delivery trust. The web app is designed to make that transition straightforward: no server-side rendering, no platform-specific APIs, no Node.js dependencies in the crypto layer.

## Stack

The stack is settled. All decisions below are final for v1. If you have a strong position on any of these, open an issue — but expect to make a case against the specific reasons documented in [DESIGN.md — Settled stack](./DESIGN.md#codebase-assumption).

### Protocol-mandated (non-substitutable)

These are determined by the protocol's wire format. Changing them produces incompatible ciphertext or breaks the instance API contract.

| Concern | Choice | Reason |
|---|---|---|
| Cryptography | `@noble/curves` (secp256k1) + `@noble/hashes` (HKDF-SHA256) + Web Crypto API (AES-256-GCM) | Must match the instance exactly. Any substitution produces ciphertext the instance cannot read. |
| Chain | Base (mainnet) / Base Sepolia (testnet) | Canonical identity chain per the protocol spec. |
| Chain interaction | [viem](https://viem.sh) | TypeScript-first, tree-shakable, contract ABI type inference. |
| Build tool | [Vite](https://vitejs.dev) | SPA requirement, Tauri compatibility, fast HMR. SSR build tools are ruled out. |
| Language | TypeScript, strict mode | Protocol wire formats, ABI types, and hex addresses are type-sensitive. |

### Application stack

| Concern | Choice | Reason |
|---|---|---|
| UI framework | React 19 | wagmi is React-first; deepest wallet integration, largest web3 contributor pool, React 19 compiler reduces re-render cost on crypto-heavy state. |
| Wallet connection | wagmi + viem, custom UI | Pre-built connection modals (RainbowKit, Web3Modal) impose visual constraints furden doesn't want. Built on `useConnect` / `useAccount` / `useDisconnect` directly. |
| Router | TanStack Router | Type-safe route params end-to-end — proxy addresses and fingerprints in URLs are security-meaningful identifiers, not plain strings. |
| Server state | TanStack Query | Same ecosystem as TanStack Router; handles dependent query chains (subscribe → auth → key request) and cache invalidation correctly for the protocol's live-verification model. |
| Client state | Zustand | In-memory session store, upload pipeline state (in-memory ciphertext between phases), and derived crypto state are imperative, slice-based — exactly what Zustand handles well. |
| Styling | CSS Modules + CSS custom properties | Zero runtime, no PostCSS dependency, pairs natively with Radix UI data-state attributes. Content-forward design direction requires per-component control that utility classes fight against. |
| Component primitives | Radix UI | Headless accessible primitives (Dialog, DropdownMenu, Progress, Tabs, Checkbox, Tooltip). No visual style imposed. |
| Package manager | pnpm | Strict dependency isolation, first-class workspace support. |
| Desktop wrapper (v1.x) | Tauri | No app store dependency, lightweight, uses the existing SPA output as-is. |

## Setup

Requires **Node 20+** and **pnpm 9+**. (Build-script approvals for native deps — esbuild, keccak —
live in `pnpm-workspace.yaml`; that file is settings-only, furden is not a multi-package workspace.)

```bash
pnpm install
cp .env.example .env   # set VITE_CHAIN_ID and VITE_INSTANCE_URL
pnpm dev               # http://localhost:5173 — generates src/routeTree.gen.ts on first run
```

Other scripts:

```bash
pnpm routes        # regenerate the TanStack route tree from src/routes
pnpm typecheck     # tsr generate && tsc --noEmit
pnpm test          # vitest in watch mode (pure-module unit tests — envelope codec, …)
pnpm test --run    # one-shot run (CI / pre-commit)
pnpm build         # tsr generate && tsc -b && vite build (static SPA output)
pnpm preview       # serve the production build locally
```

The core creator→subscriber arc is implemented end-to-end:

- **Wallet & session** — connect (`/connect`) and challenge/verify sign-in.
- **Creator onboarding** (`/onboard`) — register identity, generate + encrypt the master secret, upload blobs, publish the instance URL.
- **Composer** (`/studio/post`) — the three-phase pipeline (envelope → encrypt → upload → register), for both public posts and paywalled posts (tier-derived key + access grant).
- **Tier management** (`/studio/tiers`) — create/update subscription tiers, read back from on-chain `TierSet` events.
- **Subscribe** — from a creator's tier cards: register (if needed), approve (ERC-20), `subscribe()`.
- **Reading** — creator profile (`/$handle`), post permalink (`/$handle/post/$fingerprint`), and the subscriber feed (`/feed`) assembled client-side from on-chain `Subscribed` logs, with the §8 decryption pipeline.
- **Subscriptions** (`/subscriptions`) — enumerated from on-chain logs with live expiry status and off-instance link-outs.
- **Content library** (`/studio/content`) — the creator's full inventory with per-post previews, and visibility changes run as the re-encryption pipeline (decrypt → re-encrypt under the new key → upload → register → publish → retire the old copy), never a metadata flip.

The remaining studio screens (dashboard, settings, access grants) still render placeholders. The crypto/API arc has been validated end-to-end against a local Anvil + instance loop with a headless harness (registration, grant round-trip, subscribe → key delivery → decrypt, public + paywalled paths); the browser UI flows have not yet been walked manually. Contract addresses are not filled in (`src/lib/chain.ts`), so chain reads throw on Base / Base Sepolia until a canonical deployment exists.

## Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md) first — it explains what kind of participation is actually useful right now (which is not code).

Core reading for understanding what furden needs to implement:

- [PROTOCOL.md](./PROTOCOL.md) — instance API sequences and client-side cryptography reference
- [DESIGN.md](./DESIGN.md) — UX and product design spec
- [den-architecture.md](https://github.com/HiddenMask18/den-protocol/blob/main/spec/den-architecture.md) — protocol design rationale
- [instance/README.md](https://github.com/HiddenMask18/den-protocol/blob/main/instance/README.md) — full instance API reference

**The non-negotiable constraint:** all cryptography happens client-side. The instance stores ciphertext and derives keys from the operational blob server-side. The client generates the master secret, encrypts content before upload, and decrypts content after download. This split is what makes the E2EE architecture real — a hoster who cannot read the instance's ECIES private key cannot read any content. Nothing in the UI architecture changes this requirement.

The crypto layer (`@noble/curves`, `@noble/hashes`, Web Crypto API) must not be replaced with alternatives that produce different wire formats — the instance's `decryptBlob` will reject any blob that does not conform to the exact ECIES scheme documented in [PROTOCOL.md](./PROTOCOL.md).

## License

[AGPL-3.0](./LICENSE) — any fork run as a hosted service must open source its changes.
