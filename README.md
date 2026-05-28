# furden

> **Status: early design and planning.** There is no working code yet. The design spec, platform strategy, and software stack are all under active discussion. See [DESIGN.md](./DESIGN.md) for what has been worked out and what is still open. See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to participate at this stage.

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

The software stack is **under active discussion** and not yet decided. The decisions below are either settled by hard technical constraints or are leading candidates, not final choices.

### Settled

These are not negotiable — they are determined by the protocol's wire format requirements.

| Concern | Choice | Reason |
|---|---|---|
| Cryptography | `@noble/curves` (secp256k1) + `@noble/hashes` (HKDF-SHA256) + Web Crypto API (AES-256-GCM) | Must match the instance exactly. Substituting any of these produces incompatible ciphertext. |
| Chain | Base (mainnet) / Base Sepolia (testnet) | Canonical identity chain per the protocol spec. |
| Chain interaction | [viem](https://viem.sh) | TypeScript-first, tree-shakable, best-in-class type inference for contract ABIs. |
| Build tool | [Vite](https://vitejs.dev) | SPA requirement, Tauri compatibility, fast HMR. SSR build tools (Next.js, Remix) are ruled out. |
| Language | TypeScript, strict mode | Protocol wire formats, ABI types, and hex addresses are all type-sensitive. |

### Under discussion

These are the open decisions. See [DESIGN.md — Decisions Still Open](./DESIGN.md#decisions-still-open) for the full evaluation.

| Concern | Leading candidate | Alternatives considered |
|---|---|---|
| UI framework | React 19 | Vue 3, Svelte 5 |
| Wallet connection | wagmi + viem | web3-onboard, @wagmi/core directly |
| Router | TanStack Router | React Router v7 |
| Server state | TanStack Query | SWR |
| Client state | Zustand | Jotai |
| Styling | CSS Modules + CSS custom properties | Tailwind CSS |
| Accessible component primitives | Radix UI | Ark UI |
| Package manager | pnpm | Bun |
| Desktop wrapper (v1.x) | Tauri | Electron |

Nothing in this table is final. If you have a strong position on any of these — especially if you've built something similar — open an issue.

## Setup

There is nothing to run yet. When there is, setup instructions will appear here.

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
