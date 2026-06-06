# DEN Protocol — Client Integration Reference

This document defines what furden must implement to speak the DEN protocol correctly. It covers the full API surface of a DEN instance, the client-side cryptographic operations required at each step, and the on-chain calls that bypass the instance entirely.

The instance handles: authenticated ciphertext storage, on-chain entitlement verification, and key derivation from the operational blob. The client handles: everything cryptographic — key generation, all encryption, all decryption, and wallet signing.

---

## Client vs Instance responsibilities

| Operation | Client | Instance |
|---|---|---|
| Generate master secret | ✓ | — |
| Encrypt master secret (operational blob) | ✓ | — |
| Decrypt master secret | — | ✓ (from operational blob) |
| Encrypt content | ✓ | — |
| Decrypt content | ✓ | — |
| Derive content keys | — | ✓ (returned to subscriber) |
| Sign access grants | ✓ | — |
| Verify access grants | — | ✓ |
| Check on-chain subscription/purchase | — | ✓ |
| Submit on-chain transactions | ✓ | — (operator txs only) |

---

## Client-side cryptography

### ECIES — master secret encryption

Used when a creator uploads their master secret as an encrypted blob. The client encrypts the master secret to the instance's per-creator public key (operational blob) and to their own wallet public key (portability blob).

**Algorithm:**
```
Key agreement : secp256k1 ECDH (ephemeral sender × recipient public key)
KDF           : HKDF-SHA256(ikm=sharedX, salt=ephemeralPubKey, info="den-blob-v1", length=32)
Encryption    : AES-256-GCM, 12-byte random nonce
```

The ECDH shared secret is the compressed 33-byte point from `getSharedSecret()`; strip the first byte to get the 32-byte x-coordinate (`sharedX`) used as HKDF input.

**Wire format (bytes):**
```
[0  .. 33)  compressed ephemeral secp256k1 public key (33 bytes)
[33 .. 45)  AES-GCM nonce / IV (12 bytes)
[45 .. end) AES-GCM ciphertext with 16-byte auth tag appended
```

Minimum valid blob length: 61 bytes (33 + 12 + 16 for empty plaintext).

**Implementation (TypeScript):**
```ts
import { secp256k1 } from '@noble/curves/secp256k1';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';

async function encryptBlob(plaintext: Uint8Array, recipientPubKey: Uint8Array): Promise<Uint8Array> {
  const ephPriv = secp256k1.utils.randomPrivateKey();
  const ephPub  = secp256k1.getPublicKey(ephPriv, true); // 33 bytes compressed

  const rawShared = secp256k1.getSharedSecret(ephPriv, recipientPubKey);
  const aesKeyBytes = hkdf(sha256, rawShared.slice(1), ephPub, new TextEncoder().encode('den-blob-v1'), 32);

  const nonce  = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await crypto.subtle.importKey('raw', aesKeyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
  const ct     = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, plaintext));

  const out = new Uint8Array(33 + 12 + ct.length);
  out.set(ephPub, 0); out.set(nonce, 33); out.set(ct, 45);
  return out;
}
```

**Decryption (portability blob — creator's wallet key):**

The portability blob is encrypted to the creator's wallet public key. To decrypt it (e.g. for migration), the client performs the same ECDH in reverse using the wallet private key as the recipient key. This requires the wallet to expose the raw private key — hold it only in memory and discard immediately after deriving the master secret.

---

### Content key derivation

Content keys are derived from the master secret using HKDF-SHA256 with no salt. The path determines what the key unlocks.

```
key = HKDF-SHA256(ikm=masterSecret, salt=none, info=path, length=32)
```

**Paths:**
```
Subscription tier : "tier:" + tierId      (e.g. "tier:1")
Shop item / pack  : "item:" + listingId   (e.g. "item:42")
```

The subscriber does not run this derivation — the instance does it server-side using the operational blob and returns the derived keys at `POST /access/key`. The creator runs this derivation client-side when marking content public (`PUT /creator/content/:fingerprint/visibility`) to supply the `contentKey`.

---

### Content encryption

There is no prescribed algorithm for content file encryption in the protocol spec — the key is a 32-byte secret and the ciphertext is opaque to the instance. furden standardises on **AES-256-GCM** with a prepended 12-byte random nonce:

```
[0  .. 12)  random nonce (12 bytes)
[12 .. end) AES-GCM ciphertext with 16-byte auth tag appended
```

The content key from key derivation above is the AES-256-GCM key. Use the same `crypto.subtle` API as ECIES for consistency.

The fingerprint is SHA-256 of the **ciphertext bytes** (the full blob as uploaded, including nonce). The instance computes it server-side and returns it — do not compute it in the client before uploading.

---

### Access grant signing

Access grant declarations are signed by the creator's wallet and stored both locally (instance) and on-chain (`DENAccessGrant`). The signature scheme:

```
pathsHash  = keccak256(abi.encode(paths))
structHash = keccak256(abi.encode("DEN-access-grant", proxyAddress, tierId, pathsHash, version))
ethHash    = keccak256("\x19Ethereum Signed Message:\n32" + structHash)
signature  = wallet.sign(ethHash)   // EIP-191 personal_sign
```

`version` must be `1` for a new grant or `existing.version + 1` for an update. Use `viem`'s `keccak256`, `encodeAbiParameters`, and `signMessage` for the implementation.

---

## Authentication

All protected instance routes require a session token. Sessions are per-wallet and expire after 24 hours.

```
GET  /auth/challenge?wallet=0x<address>
→ { nonce: "..." }

    client signs nonce with wallet via EIP-191 personal_sign
    (wagmi: signMessage({ message: nonce }))

POST /auth/verify
Body: { wallet: "0x...", nonce: "...", signature: "0x..." }
→ { sessionToken: "...", proxy: "0x..." }
```

Store `sessionToken` in memory (Zustand), never in localStorage. The `proxy` is the participant's stable DEN identity — it does not change on wallet rotation. Use it as the key for all subsequent operations.

All protected routes: `Authorization: Bearer <sessionToken>`

**Registration required for all participants.** The instance rejects authentication from any wallet that has not called `DENIdentityRegistry.register()`. This applies to both creators and subscribers — every participant must hold a registered DEN identity proxy before they can authenticate with any instance. The `proxy` returned by `POST /auth/verify` is always a valid, registered proxy address. An unregistered wallet receives `401 { reason: "wallet is not registered in DEN" }`.

---

## Creator onboarding

Full sequence from zero to a configured instance. Steps marked **[chain]** are on-chain transactions; steps marked **[instance]** are HTTP calls; steps marked **[client]** are local operations.

**1. Deploy identity proxy [chain]**
```
DENIdentityRegistry.register()
```
Call from the creator's wallet. Returns the proxy address (also available via `DENIdentityRegistry.getProxy(wallet)`). This is a one-time operation — the proxy address is permanent.

**2. Authenticate with the instance [instance]**

Follow the auth flow above. The proxy from step 1 is returned in the verify response.

**3. Get the instance's per-creator blob public key [instance]**
```
GET /creator/blob-pubkey
→ { pubKey: "0x02..." }   // 33-byte compressed secp256k1 key
```

**4. Generate master secret [client]**
```ts
const masterSecret = crypto.getRandomValues(new Uint8Array(32));
```
Hold in memory only. This is the root of all content key derivation.

**5. Encrypt the master secret [client]**

```ts
// Operational blob — encrypted to instance pubKey from step 3
const instancePubKey   = fromHex(blobPubkeyResponse.pubKey, 'bytes');
const operationalBlob  = await encryptBlob(masterSecret, instancePubKey);

// Portability blob — encrypted to creator's wallet public key
// Derive wallet pubKey from wallet private key via secp256k1.getPublicKey()
const portabilityBlob  = await encryptBlob(masterSecret, walletPubKey);

// Emergency portability blob — only when an emergency wallet is registered
const emergencyPortabilityBlob = await encryptBlob(masterSecret, emergencyWalletPubKey);
```

**6. Upload blobs [instance]**
```
PUT /creator/blob
Body: {
  operationalBlob:          "0x<hex>",
  portabilityBlob:          "0x<hex>",
  emergencyPortabilityBlob: "0x<hex>"   // optional — only include if an emergency wallet is registered
}
→ { stored: true }
```

The instance decrypts the operational blob to verify the correct pubkey was used, then immediately zeros the plaintext. The portability blob and emergency portability blob are stored as-is — the instance cannot decrypt them.

To check upload status (e.g. after a migration import to verify the operational blob is ready):
```
GET /creator/blob
→ { exists: boolean }
```

`exists` is `false` after `POST /creator/import` until the creator re-uploads the operational blob re-encrypted to the new instance's key.

To retrieve the portability blob for recovery or backup (the instance returns the blob encrypted to the authenticated wallet's key — primary wallet gets the portability blob, an emergency wallet gets the emergency portability blob):
```
GET /creator/portability-blob
→ <raw bytes, Content-Type: application/octet-stream>
```

**7. Set instance URL on-chain [chain]** *(if not already set)*
```
DENIdentityImpl.setInstanceUrl(instanceUrl)
```
Called from the creator's proxy's registered wallet. Required for client-side routing — compliant clients resolve creator identity via the on-chain instance URL record.

---

## Content posting

**1. Set up a subscription tier [chain]**
```
DENSubscription.setTier(tierId, price, duration, token)
```
`price` in wei, `duration` in seconds, `token` is ERC-20 address or `address(0)` for ETH.

**2. Encrypt content [client]**
```ts
const tierKey    = deriveKey(masterSecret, 'tier:' + tierId);
const nonce      = crypto.getRandomValues(new Uint8Array(12));
const aesKey     = await crypto.subtle.importKey('raw', tierKey, { name: 'AES-GCM' }, false, ['encrypt']);
const ct         = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, plaintext));
const ciphertext = new Uint8Array(12 + ct.length);
ciphertext.set(nonce, 0); ciphertext.set(ct, 12);
```

**3. Upload ciphertext [instance]**
```
POST /creator/content
Headers: X-Tier-Id: 1
         X-Warnings: ["violence"]   // optional
Body: <ciphertext bytes, Content-Type: application/octet-stream>
→ { fingerprint: "0x..." }          // SHA-256 of ciphertext, computed by instance
```

**4. Register fingerprint on-chain [chain]**
```
DENContentRegistry.registerContent(fingerprint, tierId)
```

**5. Publish an access grant [client + instance + chain]**

Access grants declare which derivation paths a tier authorises. For a simple single-tier setup, the grant for tier 1 maps to `["tier:1"]`.

```ts
// Client: sign the grant
const paths     = ['tier:1'];
const pathsHash = keccak256(encodeAbiParameters([{ type: 'string[]' }], [paths]));
const structHash = keccak256(encodeAbiParameters(
  [{ type: 'string' }, { type: 'address' }, { type: 'uint256' }, { type: 'bytes32' }, { type: 'uint256' }],
  ['DEN-access-grant', proxy, tierId, pathsHash, version]
));
const signature = await signMessage({ message: { raw: structHash } });
```

```
// Instance: store locally
POST /creator/grant
Body: { tierId: "1", paths: ["tier:1"], signature: "0x...", version: 1 }
→ { stored: true }
```

```
// Chain: publish on-chain
DENAccessGrant.publishGrant(tierId, paths, signature)
```

To retrieve a stored grant (e.g. to read the current version before publishing an update):
```
GET /creator/grant/:tierId
→ { tierId: "1", paths: ["tier:1"], version: 1 }
```

---

## Creator profile management

**Set bio [instance]**

The creator's bio is stored on the instance and returned in `GET /profile/:proxy`. The handle lives on-chain via `DENIdentityRegistry.handleOf(proxy)` — it is not set here.

```
PUT /creator/profile
Body: { bio: "..." }   // pass null to clear
→ { stored: true }
```

**Mark content public or private [instance + client]**

Public content is served without a subscription — the content key is included in `GET /profile/:proxy` so any client can decrypt it. When marking content public, the creator derives the content key from their master secret and supplies it.

```
PUT /creator/content/:fingerprint/visibility
Body: { isPublic: true,  contentKey: "0x<64 hex chars>" }
   or { isPublic: false }
→ { stored: true }
```

`contentKey` is `deriveKey(masterSecret, "tier:" + tierId)` — the same 32-byte AES-256-GCM key derived from the master secret for that tier. Making content public is the creator choosing to share that derivation output openly. Passing `isPublic: false` clears the stored key and removes public access.

---

## Public profile

No authentication required.

```
GET /profile/:proxy
→ {
    proxy, handle, bio,
    tiers: [{ tierId, price, duration, token }],
    publicContent: [{ fingerprint, tierId, timestamp, warnings, contentKey }],
    contentWarnings: [{ fingerprint, tierId, warnings }]
  }
```

`contentKey` in `publicContent` entries is the 32-byte AES key (0x-prefixed hex). To display public content:
1. `GET /content/:fingerprint` (no auth needed for public-designated content)
2. Decrypt: extract 12-byte nonce from `ciphertext[0..12]`, decrypt `ciphertext[12..]` with the key

`contentWarnings` covers paywalled posts — metadata only, no key or ciphertext.

---

## Subscriber flow

**Registration prerequisite.** Subscribers must hold a registered DEN identity proxy before they can authenticate with any instance. Call `DENIdentityRegistry.register()` with the subscriber's wallet once. This is the same one-time on-chain operation used in creator onboarding — a subscriber who has not registered will receive a 401 from `POST /auth/verify`.

**1. Subscribe on-chain [chain]**
```
DENSubscription.subscribe(creatorProxy, tierId, token, amount)
```

For ERC-20 tokens, approve `DENSubscription` for `amount` first. For ETH, pass `address(0)` as token and send value with the call.

**2. Authenticate with the instance [instance]**

Same auth flow as creator. The subscriber's session is keyed to their proxy.

**3. List the creator's content for a tier [instance]**

Before requesting keys, enumerate what the creator has published to a tier you hold. The public `GET /profile/:proxy` exposes only public content and *warned* paywalled posts — unwarned paywalled posts are invisible there. This authenticated endpoint returns the full inventory for a single tier the caller is subscribed to. It is the data source for the subscriber feed.

```
GET /content/by-creator/:proxy?tierId=1
Authorization: Bearer <sessionToken>
→ {
    content: [{ fingerprint: "0x...", tierId: "1", timestamp: 1700000000000, warnings: ["violence"] | null }],
    nextCursor: null
  }
```

Entitlement is gated per-tier by the same on-chain check as `POST /access/key`: the caller must hold an active subscription to `(proxy, tierId)` and the creator must have a signature-valid access grant for it, else `403`. Metadata only — no ciphertext, no keys. `timestamp` is Unix **milliseconds** (`Date.now()` on the instance), matching the `timestamp` field in `GET /profile/:proxy`. `content` is newest-first. `nextCursor` is reserved for future pagination and is always `null` in v1.

To assemble the feed: enumerate your subscriptions on-chain via the `Subscribed(subscriberProxy, creatorProxy, tierId, expiresAt)` event keyed by your proxy, then call this endpoint per `(creator, tier)` and merge by timestamp. The instance has no aggregated feed endpoint — subscription enumeration is always client-side on-chain.

**4. Request content key [instance]**
```
POST /access/key
Body: { type: "subscription", creatorProxy: "0x...", tierId: "1" }
   or { type: "purchase",     creatorProxy: "0x...", listingId: "42" }
→ { keys: { "tier:1": "0xabc...", "tier:2": "0xdef..." } }
```

The instance verifies on-chain entitlement live (no cache). If the subscription has lapsed or the fingerprint is suspended, the request fails. Multiple keys may be returned if the creator's access grant covers multiple tiers.

**5. Download ciphertext [instance]**
```
GET /content/:fingerprint
Authorization: Bearer <sessionToken>
→ <ciphertext bytes>
```

**6. Decrypt content [client]**
```ts
const keyHex  = keysResponse.keys['tier:1'];
const keyBytes = fromHex(keyHex, 'bytes');
const nonce    = ciphertext.slice(0, 12);
const ct       = ciphertext.slice(12);
const aesKey   = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
const plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aesKey, ct));
```

---

## Key rotation

Key rotation is entirely client-driven. The instance supports it via existing endpoints; no dedicated rotation API exists. Full protocol is in the spec §4.7 — the client's sequence:

**For each tier (do not replace blob until all tiers are done):**

1. `GET /creator/content` → list of `{ fingerprint, tierId }`
2. For each fingerprint in the tier:
   - `GET /content/:fingerprint` → old ciphertext
   - Decrypt with old content key (`deriveKey(oldMasterSecret, "tier:" + tierId)`)
   - Re-encrypt with new content key (`deriveKey(newMasterSecret, "tier:" + tierId)`)
   - `POST /creator/content` with new ciphertext → new fingerprint
   - `DENContentRegistry.registerContent(newFingerprint, tierId)` [chain]
   - `DELETE /creator/content/:fingerprint` → 204 No Content (clean up old record)

**After all tiers complete:**

- Generate new blobs for all registered wallets (same ECIES process as onboarding, using `newMasterSecret`)
- `PUT /creator/blob` with new operational, portability, and emergency blobs

**Resumability:** on restart, diff the on-chain fingerprints against `GET /creator/content`. Tiers where all on-chain fingerprints match the instance DB are complete; tiers with mismatches are incomplete. Resume from the first incomplete tier.

---

## Migration (moving to a new instance)

**1. Export from old instance [instance]**
```
GET /creator/export
→ {
    portabilityBlob: "0x...",
    content: [{ fingerprint, tierId, warnings, timestamp }],
    grants:  [{ tierId, paths, version, signature }]
  }
```

The export bundle contains the portability blob (encrypted to the creator's wallet — only they can decrypt it), all content references, and all signed access grants.

**2. Get the new instance's blob pubkey [instance]**
```
GET <newInstance>/creator/blob-pubkey
→ { pubKey: "0x02..." }
```

**3. Re-encrypt the master secret [client]**

Decrypt the `portabilityBlob` from the export bundle using the creator's wallet private key (ECIES decryption) to recover `masterSecret`. Encrypt to the new instance's `pubKey` to produce the new `operationalBlob`.

**4. Import the bundle to the new instance [instance]**
```
POST <newInstance>/creator/import
Body: { portabilityBlob: "0x...", content: [...], grants: [...] }
→ { imported: true, grantsImported: N, contentReferencesImported: N, ... }
```

Import validates every grant signature before writing anything — it is all-or-nothing. After a successful import, `GET /creator/blob` on the new instance returns `{ exists: false }` until the next step.

**5. Upload the new operational blob [instance]**
```
PUT <newInstance>/creator/blob
Body: { operationalBlob: "0x<re-encrypted>", portabilityBlob: "0x..." }
→ { stored: true }
```

Key delivery (`POST /access/key`) will not work until this step completes. Do not announce the migration on-chain until this step succeeds.

**6. Update the on-chain instance URL [chain]**
```
DENIdentityImpl.setInstanceUrl(newInstanceUrl)
DENIdentityImpl.announceInstanceMigration(newInstanceUrl, operatorCounterSignature)
```

**7. Re-upload content ciphertext**

The export bundle contains content references (fingerprints and metadata) but not ciphertext bytes. Content bytes must be retrieved from IPFS (if the old instance pinned to IPFS) or manually re-uploaded. Subscribers retain access to fingerprints that are already registered on-chain once key delivery is working on the new instance.

**Recovery without migration (portability blob retrieval):**

To retrieve the portability blob for local backup without triggering a full migration, use `GET /creator/portability-blob` on the current instance (auth required). The instance returns the blob encrypted to the authenticated wallet's key — primary wallet receives the portability blob, an emergency wallet receives the emergency portability blob.

---

## Moderation

The moderation layer implements the protocol floor violation reporting path (spec §12). Client-relevant routes cover evidence submission for reporting subscribers, report inspection for any participant, and creator report discovery.

**Submit evidence before filing a report [instance + chain]**

A subscriber who needs to report a protocol floor violation first submits evidence to the instance to obtain the `evidenceHash` required by the on-chain `fileReport` call. The instance cannot file the on-chain report on the subscriber's behalf — the contract checks that `msg.sender` is the reporter's registered primary wallet.

```
POST /moderation/report
Authorization: Bearer <sessionToken>
Body: {
  fingerprint:     "0x<64 hex>",   // SHA-256 of the content
  accessTimestamp: 1700000000,      // Unix seconds when the content was accessed
  category:        0,               // 0 = CSAM, 1 = NON_CONSENT
  evidence:        "<base64>"       // evidence bytes (screenshots, descriptions)
}
→ { evidenceHash: "0x...", reportRegistryAddress: "0x..." }
```

Then call on-chain with the subscriber's wallet:
```
DENReportRegistry.fileReport(contentProxy, fingerprint, violationType, evidenceHash)
```

**View a report [instance]**

Public and unauthenticated — reports are on-chain and readable by anyone.

```
GET /moderation/report/:id
→ {
    id, fingerprint, reporterProxy, accessTimestamp,
    category, evidenceHash, status, filedAt, operatorConflict
  }
```

**View all reports against your content [instance]**

Creator-authenticated. Returns every active and historical report filed against content this creator has uploaded to the instance, including off-chain evidence bytes (if submitted via `POST /moderation/report`) and the governance-set response window.

```
GET /moderation/creator/reports
Authorization: Bearer <sessionToken>
→ {
    creatorResponseWindowSeconds: "...",
    reports: [{
      reportId, fingerprint, reporterProxy, accessTimestamp,
      category, evidenceHash, evidence: "<base64>" | null,
      status, filedAt, operatorConflict
    }]
  }
```

**CSAM reinstatement after suspension expiry [instance]**

Any authenticated participant may trigger permissionless reinstatement after the CSAM suspension period elapses with no law enforcement action. The contract enforces the time condition — this call reverts if the period has not elapsed or an LE hold is active.

```
POST /moderation/report/:id/reinstate
Authorization: Bearer <sessionToken>
→ { txHash: "0x...", reportId: "..." }
```

---

## Governance parameters

Live on-chain values that affect client behaviour. Fetch at startup or when needed — values can be updated by governance.

```
GET /governance/params
→ {
    identity:     { wallet_rotation_delay, rotation_announcement_cooldown,
                    handle_change_allowance, handle_change_period, handle_alias_retention_window },
    content:      { subscriber_protection_window, sunset_window_duration },
    compensation: { storage_compensation_lookback,
                    instance_size_brackets: { micro_max, small_max, medium_max } },
    trust_tiers:  { thresholds: { tier_1, tier_2, tier_3 }, lookback_window,
                    post_size_limits: { tier_0, tier_1, tier_2, tier_3 },
                    post_rate_limits: { tier_0, tier_1, tier_2, tier_3 } },
    reporting:    { creator_response_window, csam_suspension_duration },
    fees:         { protocol_fee_bps },
    misc:         { inactivity_grace_period, batch_settlement_interval,
                    subscription_expiry_grace_period, resolver_cache_ttl }
  }
```

Key values the client cares about:
- `identity.wallet_rotation_delay` — delay window for compromise rotation (show to user)
- `content.subscriber_protection_window` — how long subscribers retain access after sunset notice
- `trust_tiers.post_size_limits` / `post_rate_limits` — enforce before attempting upload to avoid 413/429
- `fees.protocol_fee_bps` — show in subscription pricing UI (2.5% = 250 bps at launch)
- `reporting.creator_response_window` — show to creators when a report is filed against their content

All numeric values are strings (BigInt serialisation). `post_rate_limits.tier_3` returns `"unlimited"`. `trust_tiers.lookback_window` returns `"all-time"` when 0.

---

## On-chain contract reference

All contracts are on Base (mainnet) / Base Sepolia (testnet). Addresses are protocol constants per chain — they are not per-instance configuration and are not fetched from the instance. See `furden-architecture.md §2` for the contract address sourcing decision and the dev override pattern for local Anvil.

| Contract | Key client calls |
|---|---|
| `DENIdentityRegistry` | `register()`, `isRegistered(wallet)`, `getProxy(wallet)`, `handleOf(proxy)` |
| `DENIdentityImpl` (via proxy) | `setInstanceUrl(url)`, `addEmergencyWallet(wallet)`, `initiateCleanRotation(...)`, `initiateCompromiseRotation(newWallet)`, `announceInstanceMigration(url, sig)` |
| `DENSubscription` | `setTier(tierId, price, duration, token)`, `subscribe(creatorProxy, tierId, token, amount)` |
| `DENContentRegistry` | `registerContent(fingerprint, tierId)` |
| `DENAccessGrant` | `publishGrant(tierId, paths, signature)` |
| `DENPurchaseState` | `purchase(creatorProxy, listingId, token, amount)` |
| `DENReportRegistry` | `fileReport(contentProxy, fingerprint, violationType, evidenceHash)` |

ABIs are in `den-protocol/abis.ts` — the single source of truth for both the instance and furden. Import from there rather than writing from scratch.
