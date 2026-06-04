# Contributing to furden

furden is in early design and planning. There is no working code yet. This document explains what kind of participation is useful right now — and what to hold off on until the project is further along.

---

## Where things stand

The DEN protocol itself is essentially complete. The furden client is where work is now happening, and it is at the very beginning:

- [PROTOCOL.md](./PROTOCOL.md) — the cryptographic and API contract between furden and a DEN instance. This is finished and binding. It defines exactly what furden must implement.
- [DESIGN.md](./DESIGN.md) — the product and UX design spec. This captures a significant amount of thinking about flows, information architecture, and design constraints. It is a working document, not a final spec. Some sections are reasoned through; others are explicitly provisional.
- The software stack is decided. React 19, TanStack Router, TanStack Query, Zustand, wagmi, CSS Modules, Radix UI, pnpm, Vite. See [README.md — Stack](./README.md#stack) for the full list and rationale.

The next concrete step is the application scaffold. Until that is in place, the most valuable contributions are to the design thinking, not the implementation.

---

## What's useful right now

### Reading and reacting to the design spec

[DESIGN.md](./DESIGN.md) documents the intended UX for the creator onboarding wizard, the posting flow, the subscription flow, session management, and more. If you're a creator who has used Fansly or SubscribeStar, a subscriber who has navigated similar platforms, or a developer who has built something in this space — your read of that document is genuinely useful.

Open an issue if something in the spec seems wrong, incomplete, or missing. Cite the specific section. Explain what the concern is and why. Vague "I don't like this" is not useful; "This step in the onboarding wizard assumes the user has already set up a wallet, but the target audience is migrating from Fansly and many won't have one — here's what I think should happen instead" is.

### Protocol knowledge

If you've read [PROTOCOL.md](./PROTOCOL.md) and you think something in the client design spec misunderstands or misrepresents what the protocol requires, open an issue. The design spec must accurately reflect the protocol's constraints. Errors here become bugs later.

### Design and visual direction

[DESIGN.md — Visual Design Direction](./DESIGN.md#visual-design-direction) sketches the visual intent but doesn't go further than that. If you do visual design or UI work and you have thoughts about what this client should look like — colour direction, type, layout — open an issue or post something to discuss. The visual design hasn't been developed yet and input from people in the community is relevant.

---

## What to hold off on

### Code contributions

The stack is decided but the scaffold is not yet in place. Any code written now would have nowhere to land. Wait until the first scaffold is committed — it will establish the directory structure, tsconfig, Vite config, and routing conventions that all subsequent code must conform to.

When code contributions open up, this document will say so explicitly and explain what the setup process looks like.

### Development setup (once the scaffold lands)

furden is a self-contained repository. Clone it and install:

```
git clone https://github.com/HiddenMask18/furden
cd furden
pnpm install
pnpm dev
```

No other repository is required. Contract ABIs are vendored in `src/lib/abis.ts`, copied from [den-protocol](https://github.com/HiddenMask18/den-protocol). If the protocol contracts change, that file is updated here as part of the same PR that requires the change.

### Feature requests

The scope for v1 is documented in [DESIGN.md — Scope](./DESIGN.md#scope). The exclusions are deliberate and have documented reasons. Opening issues for things in the out-of-scope table is not useful at this stage — those decisions aren't arbitrary and re-litigating them before anything is built adds noise without value.

If you have a strong argument that something in the out-of-scope list was excluded for the wrong reason, make that argument with specific reasoning. "I think video should be in v1 because X" is a different kind of issue than "can you add video."

### Questions about how to run it

There is nothing to run. When there is, the README will say so.

---

## The one thing that will not change

All cryptography happens client-side. The master secret is generated in the browser, encrypted before it leaves the device, and never transmitted in plaintext. The content encryption and decryption pipeline runs locally. The session token lives in memory only.

This is not a design preference. It is the property that makes the E2EE architecture real. No UI decision, framework choice, or contributor preference changes this. If you are considering a contribution that would move any cryptographic operation off the client, the answer is no.

The specific cryptography libraries — `@noble/curves`, `@noble/hashes`, and the Web Crypto API — must not be substituted. The instance uses the same libraries and will reject ciphertext that does not conform to the exact scheme in [PROTOCOL.md](./PROTOCOL.md).

---

## How to open an issue

Use GitHub issues. There are no templates yet — just be clear about what section of which document you're responding to, what the concern is, and what you think should happen instead.

If you're not sure whether something is worth raising: raise it. This is early enough that almost any relevant observation has value.

---

## Who this is for

DEN was built by a furry artist for the furry community. That's who furden is for, and that's whose input matters most on what this client should feel like to use. If you're a creator who has been through a platform purge, a subscriber who has lost access to content when a platform changed its policies, or someone who has watched this pattern play out and wants something different — your perspective on what this client needs to do is the most relevant input of all.

Technical contributors who are not part of the community are welcome. The protocol is sound, the architecture is interesting, and the problem is real. But the people this is being built for should have the loudest voice in what it becomes.
