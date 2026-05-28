# furden — Design Specification v0.1

> **Status: brainstorm and early planning.** This document captures thinking-in-progress. Sections marked as resolved reflect decisions that have been reasoned through and are unlikely to change. Sections that reference the stack (framework, routing, styling, component library) are explicitly provisional — those decisions are still being made. Do not treat anything here as final until the status notice is removed.

This document is the product and UX design spec for the furden reference client. It resolves platform assumptions, scope, information architecture, core flows, and design constraints before component work begins. Ambiguous product decisions resolved here do not need to be re-litigated in code.

This document is a companion to [PROTOCOL.md](./PROTOCOL.md), which defines the cryptographic and API contract between furden and a DEN instance, and to [README.md](./README.md), which tracks the current state of the software stack discussion.

---

## Platform Strategy

### Codebase assumption

> **Under discussion.** The framework, router, styling approach, and component library are not yet decided. See [README.md — Stack](./README.md#stack) for the full evaluation of candidates and open questions. The constraints below apply regardless of which framework is chosen.

A single SPA with no server-side rendering. One codebase that runs entirely in the browser. SSR build tools (Next.js, Remix, SvelteKit in SSR mode) are ruled out by two hard constraints: the in-memory session model requires a pure client-side runtime, and the Tauri desktop wrapper path requires a static SPA output.

The Tauri desktop wrapper is a natural v1.x path — the web app is designed to make that transition low-effort regardless of which framework is chosen. This means: no SSR, no Node-specific APIs in the crypto layer, Web Crypto API throughout as required by the protocol. Nothing in the UI architecture should require re-writing for Tauri.

**Settled technical constraints that apply to any framework choice:**
- Vite as the build tool (SPA requirement, Tauri compatibility)
- viem for chain interaction (TypeScript-first, protocol ABIs)
- `@noble/curves` + `@noble/hashes` + Web Crypto API for cryptography (protocol-mandated, non-substitutable)
- TypeScript strict mode throughout
- No localStorage for session tokens or key material (in-memory only)

### Viewport strategy

**Creator flows are desktop-first (1024px+ minimum comfortable viewport).**

The creator experience — onboarding wizard, studio, posting, tier management — demands screen real estate and deliberate focus. Mobile creator flows are out of scope for v1.

Reasons:
- The onboarding sequence involves multiple chain transactions. MetaMask extension UX on desktop is significantly more reliable than WalletConnect on mobile.
- Local encryption of large files in a mobile browser is constrained by memory. Desktop browsers have no practical ceiling.
- The studio interface is management-dense. Tier management, access grant declarations, content library — these surfaces need a real screen.
- The security model demands conscious attention during master secret generation. That conversation is harder to have on a phone.

**Subscriber flows are responsive from day one.**

Browsing, discovering, and subscribing must work on mobile. A subscriber on a phone who encounters a broken layout at the moment they want to subscribe is a lost subscriber.

Mobile subscriber support means:
- All subscriber-facing routes render correctly at 375px+
- Wallet connection via WalletConnect covers mobile wallet users
- Content decryption of images and text works fine in mobile browsers
- The creator onboarding wizard and studio are excluded from mobile polish requirements in v1

**Future path:** Tauri wrapper for desktop app, progressive enhancement of mobile subscriber flows in v1.x.

---

## User Personas

### Sage — the migrating creator

Established furry artist with 200–500 subscribers on Fansly or SubscribeStar. Moved by platform policy, not by crypto enthusiasm — may be crypto-adjacent but is not a developer. Posts primarily images: commissions, sketches, WIPs, art packs. Has a regular cadence and expects a studio experience comparable to what they left.

Uses furden on desktop. Likely Chrome or Firefox on Windows or Mac.

Key anxieties: "Is my content actually private?", "What happens if I lose my wallet?", "Will my subscribers find me here?"

Design implication: every security guarantee the protocol provides must be communicated in plain language, not in cryptographic terms. The onboarding flow earns trust by explaining what is happening to the user's keys, not by hiding it.

### River — the subscriber

Furry fan who supports 5–10 creators. May have no prior crypto experience and needs a clear path to wallet setup. Discovers creators through community links, word of mouth, or other creators' profiles. Browses on a mix of phone and desktop. Subscribes when the moment strikes — often on mobile.

Key anxieties: "I don't understand what a wallet is", "Will my subscription actually work?", "Is this safe?"

Design implication: the path from landing on a creator's profile to having a paid subscription must be as direct as possible. Friction before the subscription is locked in is friction that costs creators subscribers.

### The coexistence case

A creator is often also a subscriber to other creators. One wallet may hold a creator identity and active subscriptions simultaneously. The app must handle this without confusion — the studio is a distinct context, not a different account.

---

## Scope

### v1 in scope

**Creator:**
- Creator onboarding wizard (full sequence: wallet → identity → master secret → instance → first tier)
- Creator profile page (public-facing, editable from studio)
- Studio dashboard with recent activity and quick-action CTA
- Posting flow: images and text, with local encryption pipeline and on-chain registration
- Subscription tier management: create, edit (on-chain)
- Access grant management: create, update (on-chain + instance)
- Content library: list, manage visibility, delete
- Emergency wallet registration (surfaced in settings, not buried — the protocol strongly recommends it)
- Session management: in-memory token, auto-reconnect on page refresh

**Subscriber:**
- Public browsing without a wallet on all public routes
- Wallet connection and session authentication
- Subscription flow: tier selection → on-chain transaction → key request → content unlock
- Subscribed content feed (timeline, newest first)
- Content decryption and display: images and text
- Content warning acknowledgment: blur-by-default + click-through per card
- Subscription status display: active, expiring soon, expired
- Governance parameter display where relevant to subscriber actions (protocol fee in subscription pricing, post size limits surfaced on upload)

**Protocol housekeeping:**
- Governance parameter fetch at startup
- Network / chain indicator (Base Sepolia vs mainnet) visible at all times
- Transaction state display: consistent three-step progress component across every on-chain operation

### v1 explicitly out of scope

These are deliberate exclusions, not oversights. Each has a documented reason.

| Feature | Reason for exclusion |
|---|---|
| Video content | Streaming E2EE video (chunked, seekable, memory-safe) is a distinct technical problem. Define and spec separately. |
| Key rotation UI | The re-encryption flow is correct and well-specified in PROTOCOL.md §Key Rotation. The UI is complex. Stub the route in studio settings, mark coming soon. |
| Instance migration wizard | Same rationale. The export endpoint exists. The guided UI is v1.x. |
| Mobile creator flows | Creator onboarding and studio on mobile. Responsive minimum, not polished. |
| Shop / one-time purchases | DENPurchaseState is designed for in the protocol. Subscription only in v1. |
| Push notifications | No protocol push mechanism. Out of scope until there's something to push from. |
| Multi-instance selection | App connects to one VITE_INSTANCE_URL. Instance discovery and selection is not a v1 UI concern. |
| Cross-instance discovery | Requires aggregation infrastructure that does not yet exist. |
| In-app handle registration | Protocol supports handles. v1 displays a handle if already registered, reads it from the on-chain identity record. In-app registration is v1.x. |
| Creator analytics | The instance API does not surface analytics in the current spec. Stub the studio route. |
| Social follows without subscription | Subscribing is the follow. There is no free-tier follow concept in the protocol. Do not design one in. |
| In-app messaging | Not in the protocol. Not hinted at in the UI. |
| Comment systems | Out of protocol scope. |
| Fiat onramp | DEN uses crypto-native payments. Onramp integration is structurally separate. |
| Email/SMS recovery | Instance-level optional feature (spec §2.6.3). Not a v1 client design concern. |
| Light mode | v1 is dark only. Light mode can be added without rearchitecting. |

---

## Information Architecture

### Route structure

```
PUBLIC — no wallet required
───────────────────────────────────────────────
/                   Discover — trending creators, public content feed
/explore            Browse creators
/[handle]           Creator profile (public content, tier cards, locked previews)
/about              What is DEN — for users who don't know the protocol

SUBSCRIBER — wallet connected + active session
───────────────────────────────────────────────
/feed               Subscribed content timeline
/[handle]           Creator profile (subscribed content now visible)
/subscriptions      Active subscriptions — status, renewal dates
/settings           Wallet, connected network, session

CREATOR STUDIO — creator identity registered + active session
───────────────────────────────────────────────
/studio             Dashboard — recent posts, quick actions
/studio/post        New post composer
/studio/content     Content library
/studio/tiers       Subscription tier management
/studio/access      Access grant declarations
/studio/settings    Handle, bio, emergency wallet
/studio/keys        Key rotation — stub (v1.x)
/studio/migrate     Instance migration — stub (v1.x)

ONBOARDING / UTILITY
───────────────────────────────────────────────
/onboard            Creator onboarding wizard
/connect            Wallet connection entry (redirect target from gated routes)
```

### Navigation model

Two distinct nav contexts:

**Public / subscriber nav — top bar, full width**

- Logo / home link (left)
- Explore link
- Feed link (shown only when authenticated)
- Wallet badge (right) — shows truncated address when connected, "Connect Wallet" when not
  - Chain indicator embedded in the wallet badge (e.g. "Base" or "Base Sepolia" label or colored dot)
  - Clicking the badge: dropdown with proxy address, session status, disconnect option

**Creator studio nav — side rail, desktop only**

- Logo / back to main site (top)
- Dashboard
- New Post (primary CTA, visually distinct)
- Content Library
- Tiers
- Access Grants
- Settings
- Divider
- Key Rotation (dimmed, "Coming soon" tooltip)
- Instance Migration (dimmed, "Coming soon" tooltip)
- Chain/session status badge (bottom)

The studio is a visually distinct context from the subscriber-facing app. A creator entering `/studio` should feel like they have switched into a tool. The chrome is different, the density is higher, and the background tone shifts to communicate "this is your workspace."

---

## Core Flows

### Flow 1: Public browsing → Subscription

**Entry points:** direct link to a creator profile, discover page, community word of mouth

---

**Screen: Creator Profile (unauthenticated)**

- Header: creator avatar, handle or truncated proxy address, bio, instance attribution ("Hosted on [instance name]" in footer — links to instance info)
- Subscription tiers: one card per tier — name, price in token + approximate USD if exchange rate is available, billing duration, "Subscribe" CTA per tier
- Public content: rendered normally in a card feed, newest first
- Locked content previews: blurred card thumbnail + content warning chips + "Subscribe to [Tier Name] to unlock" overlay
  - Content warning blur always applied for warned content, even for authenticated subscribers who have not acknowledged the warning in this session
  - The overlay does not state the content of the locked post — only the access requirement

**Screen: Tier Selection modal**

Triggered by "Subscribe" on any tier card. Shows tier detail:
- Tier name and full description if set
- Price breakdown: [amount] [token] per [duration], protocol fee note ("2.5% protocol fee applies — drawn from subscription amount")
- "Subscribe" button
- If wallet is not connected: button label is "Connect Wallet to Subscribe" — clicking opens wallet connection, then returns to this modal

**Chain interaction: Subscription**

Three-step progress, sequential:

1. "Approve token spend" — only shown for ERC-20 tokens, not ETH. Explains briefly why this step exists.
2. "Confirming subscription on-chain" — transaction broadcasting; tx hash shown with block explorer link as soon as it is available
3. "You're subscribed" — checkmark; content begins unlocking

After on-chain confirmation:
- Auth challenge fires automatically (wallet signature prompt labeled "Sign in to your session")
- After authentication: content key request fires silently
- Locked content cards on the profile transition from blurred to revealed as keys are received and decryption completes — no hard page reload

**Subscription error states:**
- Wallet rejected: "Transaction cancelled. You have not been charged."
- Chain tx reverted: "Transaction failed. No funds were moved. [View on explorer]"
- Auth failed after successful tx: "Your subscription is confirmed on-chain. Refresh and sign in to access your content." (non-blocking, does not require losing the page state if avoidable)
- Key request failed (subscription lapsed between confirm and key request): "Your subscription appears to have expired. [Renew]"

---

### Flow 2: Creator Onboarding

**Entry:** `/onboard`, or triggered automatically when a connected wallet has no registered creator identity

Single-page wizard with a progress bar and step count. Back navigation is allowed on all steps except steps that have already submitted chain transactions. No other navigation chrome visible — this is a focus moment.

---

**Step 1: Connect Wallet**

- Wallet options: MetaMask, Coinbase Wallet, WalletConnect (covers mobile wallets for future-proofing)
- Small secondary text for crypto-new users: "Don't have a wallet? [How to get started ↗]" — external link, not built into the app
- No password. No email. Explicit acknowledgment: "Your wallet is your key to DEN. There is no password reset."

---

**Step 2: Create Your DEN Identity**

What the user sees: plain-language explanation that this creates a permanent identifier that belongs to them, independent of any platform or hoster.

What this does technically: `DENIdentityRegistry.register()` on Base.

UI:
- Estimated gas shown
- "Create Identity" button → wallet confirmation prompt → tx broadcasting → confirmed
- Success: proxy address displayed ("Your DEN identity: 0x...4f2a"), copy button
- The proxy address is their stable identifier. A tooltip explains: "This address stays with you even if you change wallets or move to a different server."

---

**Step 3: Set Up Your Encryption**

What the user sees:

> "DEN encrypts everything you post on your device, before it ever leaves your browser. We're setting up your encryption now."

Progress states (auto-advancing, no user input):
1. "Generating your encryption keys..." — master secret generation via `crypto.getRandomValues`
2. "Securing your keys to your wallet..." — ECIES encryption to instance pubkey and wallet pubkey
3. "Uploading to your instance..." — `PUT /creator/blob`

When complete, a short paragraph:

> "Your encryption keys were generated here, in this browser. They're encrypted to your wallet before being stored anywhere — the instance operator cannot read them, and neither can DEN. If you add an emergency wallet later, you'll have a backup path to your keys."

No technical terminology. The word "ECIES" does not appear. "Master secret" does not appear. The user understanding is: keys live here, encrypted before they go anywhere.

---

**Step 4: Choose Your Instance** *(conditional)*

Shown only if the app is deployed without a fixed `VITE_INSTANCE_URL`, or if the deployment intentionally exposes instance selection. For most deployments this step is replaced with a simple confirmation: "You're connected to [Instance Name]."

If shown: input field for instance URL, verify button (checks connectivity and fetches blob pubkey), confirmation of instance name.

After this step: `DENIdentityImpl.setInstanceUrl(instanceUrl)` chain tx, same three-step progress pattern.

---

**Step 5: Create Your First Subscription Tier**

- Tier name (text input)
- Price: token selector + amount input
- Duration: preset options (1 month / 3 months / 6 months / 1 year) + custom
- Preview: "Your subscribers will pay [X] [token] every [Y]"
- "Create Tier" → chain tx → confirmed

Skip option: "I'll set up tiers later." — displayed with a note that content cannot be assigned to a tier until one exists.

---

**Step 6: You're Ready**

Summary:
- Identity address (copyable)
- Instance name
- Tier created (name + price) or "No tier yet — set one up before you post"
- Emergency wallet prompt: "Consider adding an emergency wallet in your settings. It gives you a recovery path if you lose access to this wallet." Link to `/studio/settings`.

Two CTAs: "Go to Studio" (primary), "View Your Profile" (secondary).

---

### Flow 3: Posting Content

**Entry:** Studio dashboard → "New Post" button, or directly to `/studio/post`

**Composer layout (desktop, two-panel):**

Left panel — content:
- Text input area (plain text for v1; markdown rendering is v1.x)
- Image upload area: drag-and-drop or file picker
  - Selected images shown as thumbnails in a row, each with a remove button
  - Per-file size shown on hover; total size shown in upload area footer
  - Soft limit from governance params surfaced as tooltip: "Your trust tier allows up to [X] MB per post"

Right panel — settings:
- **Access level:** segmented control or dropdown — "Public" or list of creator's tier names
- **Content warnings:** checkbox group — `explicit`, `violence`, `gore`, `vore`, `other_kink`; custom tag text input below
- **Post preview:** live card preview showing what subscribers see vs. non-subscribers (toggleable)

Bottom action bar:
- Character count (text), total upload size (files)
- "Post" primary button

---

**Posting pipeline (replaces composer on submit, full-width progress view):**

Three sequential phases:

**Phase 1 — Encrypting**
"Encrypting your content on this device..."
- Per-file progress if multiple images
- This is local computation — no network involved
- Note displayed: "Your content is encrypted here, in your browser, before it's sent anywhere."

**Phase 2 — Uploading**
"Uploading encrypted content..."
- Upload progress bar (bytes transferred / total)
- Returns fingerprint from instance — fingerprint not known until this step completes; the client does not compute it in advance

**Phase 3 — Registering on-chain**
"Registering your post..."
- Sub-step A: `DENContentRegistry.registerContent(fingerprint, tierId)` — tx hash shown
- Sub-step B: Access grant update if the tier's grant needs to be updated (new tier, path change) — additional tx if needed
- Both steps use the standard three-step progress component

**Done state:**
- "Your post is live"
- Post card preview (same as the preview from the composer)
- "Copy link to post" button
- "Back to Studio" and "Post Again" CTAs

**Error recovery:**

Upload failure: "Upload failed. Your content was encrypted locally — you can retry the upload without encrypting again." Retry button re-attempts Phase 2 with the in-memory ciphertext. The encrypted blob is held in Zustand until either the post succeeds or the session ends.

Chain tx failure: "On-chain registration failed. Your content was uploaded successfully but won't be accessible until registration completes. [Retry registration]" Retry button re-attempts Phase 3 with the fingerprint already known from Phase 2.

---

### Flow 4: Session Recovery on Refresh

This is silent UX. The user should not need to think about it, but the implementation must be deliberate.

On page load:
1. Check if a wallet is already connected (wagmi `useAccount`)
2. If connected: immediately fire `GET /auth/challenge` and prompt wallet signature
3. Wallet popup label: "Sign in to your DEN session"
4. On successful signature: `POST /auth/verify` → session token into Zustand
5. UI resolves to authenticated state — the user sees their feed, their studio, etc.

If wallet is not connected: page loads in unauthenticated state. No prompt. User connects manually.

If connected wallet but user rejects the signature: non-blocking banner at the top of the page: "You're not signed in. [Sign in →]" Clicking re-fires the wallet signature prompt. The banner persists. It does not block public content browsing.

The re-auth step is not an error state and must not be communicated as one. The label "Sign in to your session" is chosen deliberately over "Session expired" — the session didn't expire; a new one is beginning.

---

### Flow 5: Content Viewing (Subscriber, Authenticated)

**Creator profile, authenticated and subscribed:**

- Content feed: card-per-post, newest first
- Each card: creator avatar + handle, relative timestamp, content warning chips (if any), content
- Images: displayed at natural aspect ratio up to a max width; click opens fullscreen lightbox
- Text: rendered as plain text in v1

**Content warning handling:**
- Any post with content warnings is blurred by default, regardless of subscription state
- Each card shows: warning chip labels + "Show [warning] content" button
- Acknowledgment is per-session and per-card — there is no global "I accept all warnings" setting
- The choice to acknowledge is the user's; the default is protected

**Locked content cards (not subscribed to relevant tier):**
- Blurred card with tier name overlay
- "Subscribe to [Tier Name]" CTA that opens the tier selection modal

**Decryption UX:**
- Decryption of images and text is fast. It must feel invisible — card skeleton resolves to content without a visible "Decrypting" step in the normal case.
- If decryption takes more than 300ms (large file), a subtle inline spinner replaces the skeleton briefly
- No persistent "Decrypting..." label. The protocol works; the UI should not make it feel slow.

---

## UI States

Every data-dependent surface has four states. All four must be designed. Accidental empty states and blank error pages are not acceptable.

| State | Requirement |
|---|---|
| **Loading** | Skeleton or spinner. Never a blank white area. Never a page that partially loads without indication that more is coming. |
| **Empty** | Actionable. "No posts yet — [Post your first content]" in the studio library. "No subscriptions yet — [Explore creators]" in the subscriber feed. |
| **Error** | Human-readable. No raw error text, no HTTP status codes. Always an action: retry, disconnect wallet, go back, try again later. |
| **Partial** | Content loaded while supplementary data is still arriving (e.g. post visible while decryption keys are in flight). Render what you have. Skeletonize what's missing. |

---

## Chain Transaction Design Pattern

Every on-chain operation in furden uses the same UI component. Consistency across all transactions teaches users what to expect, regardless of which transaction they're in.

**The three-step progress component:**

```
● Waiting for wallet confirmation
◌ Broadcasting to network
◌ Confirming on-chain
```

States per step:
- Pending: muted, unfilled circle icon
- Active: highlighted, spinner icon
- Done: filled circle, checkmark icon (success color)
- Failed: X icon (error color), inline error message below the failed step with a specific explanation

**Transaction state details:**

1. "Waiting for wallet confirmation" — user has not yet confirmed in their wallet extension or app. No timeout. Cancellable.
2. "Broadcasting to network" — user confirmed, tx is in the mempool. Show tx hash and block explorer link immediately — this is the trust signal.
3. "Confirming on-chain" — waiting for block inclusion. Simple text is sufficient; block confirmation counts are unnecessary noise for users.

**Never:**
- Block the full viewport while a transaction is pending. Show progress in a panel, modal, or persistent banner. Allow navigation away with a warning: "Your transaction is still processing."
- Show raw transaction data, calldata, or hex to the user.
- Show gas amounts in wei. Convert to ETH. Showing an approximate USD equivalent is helpful if an exchange rate is available.

---

## Design Constraints from the Protocol

These are not design choices — they are protocol requirements. The design accommodates them; it does not negotiate around them.

**Session tokens are memory-only.** No persistent login. Page refresh requires re-authentication. This is correct behavior, not a limitation to apologize for. The re-auth flow must be smooth and fast, not an error screen.

**Master secret never leaves the client in plaintext.** The onboarding copy must communicate this honestly. "Your encryption keys are generated here, in your browser, and secured to your wallet before being stored anywhere" is the plain-language version. The words "master secret," "ECIES," and "HKDF" do not appear in user-facing copy.

**Decryption happens locally.** Content downloads as ciphertext and decrypts in-browser. Large files introduce brief latency between download complete and content display. Design for it — don't pretend the download is the final step.

**The fingerprint is computed server-side.** The client does not know the content fingerprint before upload completes. The posting flow is designed around this: Phase 3 (on-chain registration) cannot begin until Phase 2 (upload) completes and the fingerprint is returned.

**Subscription state is verified live by the instance.** The instance checks on-chain state on every key request. There is no local cache of access decisions. Every content key request can fail. Every content access path must handle denial gracefully — including mid-session if a subscription lapses.

**Content warnings are a creator declaration, not editorial.** They are declared at post time, stored with the content record, and returned in metadata. The client is responsible for the blur-and-acknowledge UX pattern. The client must apply it consistently — it is not optional for warned content.

**The proxy address is the stable creator identity.** Wallet rotation does not change the proxy. Handle changes do not change the proxy. The proxy address is what subscriber relationships, content references, and subscription state resolve against. All internal routing should be keyed to proxy, with handles as display aliases only.

---

## Visual Design Direction

**Dark by default.** No light mode in v1. The community strongly prefers dark UIs for content consumption. The direction is dark backgrounds, high-contrast text. A light mode can be added later without rearchitecting.

**Content-forward.** The UI chrome recedes. Creator art is the main character. Post cards maximize the content area and minimize metadata chrome — timestamps, handles, and action controls are secondary, smaller, and lower-contrast.

**Single accent color.** Used only for primary actions and active states. Not used to color-code information that users need to act on — error states communicate through icons and text, not color alone.

**Typography:** System font stack for body copy (fast, no CDN dependency). A display typeface for the wordmark and studio headers can be added without affecting the reading experience.

**Chain/wallet affordances:** Native to the app, not bolted on. The wallet badge in the header is compact. Expanded detail (proxy address, current network, session status) lives in a dropdown or slide-out. The chain indicator is always visible — testnet vs. mainnet is something the user should always know at a glance.

**Trust signals throughout:**
- "Encrypted on your device" label near the posting flow
- Instance name in creator profile footers (links to instance info)
- Block explorer links on every transaction
- Session status visible in the studio nav

These are not marketing copy. They are the audit trail that makes the protocol's guarantees verifiable to users who care to check.

---

## Decisions Still Open

These require a decision before implementation reaches them. Stack decisions are flagged separately since they gate everything else.

### Stack decisions (blocking — must be decided before any code is written)

| Decision | Leading candidate | What to evaluate |
|---|---|---|
| UI framework | React 19 | Vue 3 has an official wagmi adapter and arguably better DX. Svelte 5 has the best DX but is 6 months old and the web3 ecosystem is mid-transition. React has the largest contributor pool and most mature wagmi integration. |
| Router | TanStack Router | Type-safe route params matter here — proxy addresses and fingerprints appear in URLs and are security-meaningful. TanStack Router types them end-to-end. React Router treats them as plain `string`. |
| Styling | CSS Modules + CSS custom properties | Tailwind is more contributor-accessible. CSS Modules produce cleaner component code and work without PostCSS. Tailwind is the better choice if shadcn/ui is also adopted; CSS Modules is the better choice if Radix primitives are used directly. |
| Accessible component primitives | Radix UI | Ark UI is a newer competitor from the Chakra team. Radix is more established. Either gives you accessible dialogs, dropdowns, and focus management without a bundled visual style — which furden needs since it has its own design direction. shadcn/ui is off the table without Tailwind. |
| Wallet connection UI | Custom on wagmi primitives | RainbowKit and Web3Modal provide pre-built connection modals. Both impose visual constraints furden doesn't want. Building directly on `useConnect`/`useAccount`/`useDisconnect` is more work but gives full control over the wallet badge and connection flow design. |
| Package manager | pnpm | Bun is faster and matches the instance. pnpm has stricter dependency isolation and broader CI support. Either is fine; decide once and document it. |
| Repo structure | Separate repo | A monorepo workspace (pnpm workspaces or Turborepo) would allow importing ABIs and types directly from `den-protocol`. A separate repo is simpler contributor onboarding. The ABI copying problem is manageable at current scale. |
| Web Worker for encryption | Defer to v1.x | Large file encryption on the main thread will block the UI. Moving the encryption pipeline to a Web Worker keeps the interface responsive. Not required for the initial prototype but the crypto layer should be structured to make extraction straightforward when the time comes. |

### UX decisions (blocking for specific flows)

| Decision | Notes |
|---|---|
| Rich text vs plain text for posts | Markdown rendering adds a parsing dependency and requires HTML sanitization. Plain text is safe to ship. Markdown is v1.x unless there is a strong case for it in v1. |
| Discover page content strategy | What appears on `/` for unauthenticated users? Trending creators? Most recently active? Instance-curated? This is partly an instance API question — the UI renders whatever the instance returns, but the query parameters and sort order need to be decided. |
| Image-only or image + file attachment | Art packs are typically ZIP files. Downloading, decrypting, and offering a ZIP for download in-browser is different from displaying an image. Decide before the posting flow is implemented — it affects the upload pipeline and the content card design. |
| Content card aspect ratio | Fixed ratio (cropped, click for full) vs natural ratio (everything inline). Fixed ratio is safer for feeds with mixed portrait/landscape art. Natural ratio is more respectful of the artist's composition. |
| Subscription renewal UX | When a subscription is close to expiring, how does the subscriber find out? There is no push mechanism, so detection is pull-based — on page load, on feed load, or when a key request fails. |
| Error copy voice | The manifesto has a strong, direct voice. Does the UI adopt it or use more neutral, conventional UX copy? Decide before writing any error messages or empty states — inconsistent voice across the app is worse than either choice. |
