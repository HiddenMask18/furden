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

## Walkthrough #4 checklist

Walkthrough #3 (2026-07-07) passed its entire fix queue: recovery (silent, one sign-in
signature), full owner view, visibility pipeline both directions (`archiveContent` behaved),
extend with correct ~60-day stacking, live header nav after banner sign-in, and the L0/composer
regressions. Findings are triaged in furden-architecture.md Appendix B §5. What remains and what
it surfaced:

### New fixes to confirm (from walkthrough #3 findings)

- [ ] **Subscribe refresh** — after subscribing on a creator profile, the paywalled posts must
  unlock *without a reload* (Appendix B §5 finding 1: unlocked-content/feed queries not
  invalidated on subscribe success).
- [ ] **Sign-in feedback on /connect** — the sign-in action must visibly progress/complete
  (finding 2: click appeared to do nothing while the wallet connected).
- [ ] **Banner variant after server-side kill** — with a live session 401'd, the banner must say
  "Your session ended", not "You're not signed in" (finding 3).

### L2 implicit default grants (Milestone B part 2 — add before running)

- [ ] **First paywalled post per tier = 1 transaction** — no grant signature, no `publishGrant`
  prompt for the default `tier:N` path.
- [ ] **Key delivery still works** for a tier that never published an explicit grant.
- [ ] **Explicit grants still honored** (cumulative/hierarchical paths unchanged).

### Friction counts to re-measure (baseline from #3, Appendix B §5 finding 4)

Creator onboarding 2 sig + 3 tx · every post 1 tx · first paywalled post per tier +1 sig +1 tx ·
visibility change 2 tx · fresh subscribe 2 tx. Re-count after each L-phase lands; the goal line
is L3's one-signature-per-intent.

### Regression spot-checks (cheap)

- [ ] Recovery after reload (one signature, library re-armed); owner view unlocked.
- [ ] Extend stacking; visibility pipeline; banner sign-in updates nav live.

## After the run

1. Triage every finding into Appendix B §4-style entries (confirmed bug / by-design / UX) in
   [furden-architecture.md](./furden-architecture.md).
2. Reset this checklist for the next milestone: drop what passed, carry what's still blocked,
   add what the new milestone introduces.
