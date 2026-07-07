# Live testing playbook

The standing procedure for the per-milestone live end-to-end walkthrough: how to stand up the
local loop, which wallets play which role, and the checklist of what the *next* run must verify.
Findings from a run get triaged into [furden-architecture.md](./furden-architecture.md) Appendix B;
this file carries the forward-looking list. Check items off during the run, then move anything
that failed into Appendix B with a diagnosis.

Cadence (settled 2026-07-02): batch compiler-verifiable work between milestones, walk the full
loop live once per milestone. A fix is not "done" until it has survived a live pass — the DONE
marks in Appendix B say "compiler-verified" until the checklist below confirms them.

## Local loop setup

Three processes, started in this order. All commands from the repo root (`den/`).

1. **anvil** — `anvil` (port 8545, chain 31337). Deterministic accounts and contract addresses;
   chain state is in-memory and gone on exit.
2. **Wipe the instance DB** — required on every fresh anvil, or the instance holds sessions and
   content rows referencing a chain that no longer exists:
   ```bash
   rm -f den-protocol/instance/den-instance.db*
   ```
3. **Deploy contracts** — den-protocol's deploy script. Run it **once**: a second run broadcasts a
   second (inert) contract set and the `.env` addresses must match the first, deterministic set.
   Verify with `cast code <address>` if unsure.
4. **Operator bootstrap** — the instance's operator wallet (anvil acct1) must be registered before
   the instance can countersign or serve:
   ```bash
   cast send 0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0 "register()" \
     --private-key 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d \
     --rpc-url http://localhost:8545
   ```
5. **Instance** — Bun, port **3001** (3000 is taken on the dev machine); env per
   `den-protocol/instance/.env.example`.
6. **furden** — `pnpm dev` (port 5173), `.env` pointing `VITE_INSTANCE_URL` at `:3001` and
   `VITE_CHAIN_ID` at 31337.

**Test wallets** (anvil accounts imported into MetaMask):

| Role | Account | Address |
|---|---|---|
| Instance operator | acct1 | `0x7099…79C8` (bootstrap only, never in browser) |
| Creator ("Luna") | acct2 | `0x3C44…93BC` |
| Subscriber | acct3 | `0x90F7…b906` |

**MetaMask gotchas** (both bit us in walkthrough #2):

- After every anvil restart: Settings → Advanced → **Clear activity tab data**, or the stale nonce
  cache makes every transaction fail.
- Per-site network pinning can silently route transactions to **Ethereum mainnet** — confirm the
  active network is the local chain before the first transaction of a run, per wallet.
- MetaMask covers the injected/EOA path only. Coinbase Wallet, WalletConnect, and ERC-1271
  contract wallets are a separate Phase D matrix, not part of these walkthroughs.

**Useful mid-run levers:**

- Force a mid-session 401 (tests the §5.4 banner):
  `sqlite3 den-protocol/instance/den-instance.db "DELETE FROM sessions"`
- Sessions are DB-backed; instance restarts do *not* end sessions.

## Walkthrough #3 checklist

Everything below is implemented but not yet verified live. Grouped by why it's on the list.

### Fixed 2026-07-07, needs live confirmation

- [ ] **Extend via UI** — as the subscriber, reopen the dialog on a held tier: it must show the
  extend flow (not a stale "Subscribed … Done" screen); paying again must stack (expiry moves out
  ~60 days for two 30-day payments) and the dialog must say "Extended".
- [ ] **Live header nav** — force a 401, sign back in via the banner *without navigating*:
  Feed/Subscriptions (and Studio for the creator) must appear in the header immediately.
- [ ] **Own-tier Subscribe hidden** — as the creator on your own profile: no Subscribe button on
  your tiers; the owner note ("your public profile as visitors see it") links to the library.
- [ ] **Studio → profile link** — "View public profile" on the dashboard navigates in-app; the
  master secret must survive the trip (paywalled previews still work back in the studio).
- [ ] **Honest locked copy** — with the master key absent, the library copy must not claim
  anything restores it.

### Carried over from walkthrough #2 (was blocked by the key loss)

- [ ] **Visibility-change pipeline** — make a paywalled post public and a public post paywalled:
  full re-encryption (new fingerprint, new key), old copy retired. *Watch item: `archiveContent`
  behavior on the old row.*
- [ ] **Clean Phase 8 pass** — the full session-surface sequence (mid-session 401 → banner →
  recover → continue working) without the run being disturbed by other bugs.

### Blocked on the recovery endpoint (Milestone B part 1 — add before running)

- [ ] **Master-secret recovery** — as the creator, reload the page mid-session (the walkthrough
  #2 killer), sign back in: the master secret must come back and paywalled preview, paywalled
  compose, and visibility changes must all re-arm.
- [ ] **Full owner view** — the creator's own paywalled posts render unlocked on their own
  profile.

### Regression spot-checks (passed in #2, cheap to re-confirm)

- [ ] L0 one-signature onboarding (the keys step asks for nothing).
- [ ] Composer resets after posting; tier form names its token.
- [ ] Feed and subscriptions pages assemble correctly for the subscriber.

## After the run

1. Triage every finding into Appendix B §4-style entries (confirmed bug / by-design / UX) in
   [furden-architecture.md](./furden-architecture.md).
2. Reset this checklist for the next milestone: drop what passed, carry what's still blocked,
   add what the new milestone introduces.
