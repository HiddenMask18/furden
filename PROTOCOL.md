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

The portability blob is encrypted to the creator's wallet public key. Decrypting it (e.g. during migration) performs the same ECDH in reverse using the wallet *private* key as the recipient key. An injected browser wallet does not expose its private key, so this step is not achievable in-browser with a standard wallet — recovery requires a wallet that can export its key or an out-of-band key import. Whatever the source, hold the private key in memory only and discard it immediately after deriving the master secret. The encryption side (writing the blob) needs only a signature — see Creator onboarding step 5. This recovery-side gap is v1.x; see `furden-architecture.md` Appendix B.

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

The subscriber does not run this derivation — the instance does it server-side using the operational blob and returns the derived keys at `POST /access/key`.

**Derived keys are never published.** A derivation-path key (`tier:N`, `item:N`) decrypts *every* blob encrypted under that path, and private ciphertext is downloadable by any authenticated participant (registration is permissionless). Publishing a tier key — for example as the `contentKey` of a public post — would therefore unlock the entire tier for everyone, permanently. Public content uses a fresh random per-post key instead; see "Mark content public or private" below.

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

### Post envelope (content plaintext format)

The protocol treats a content blob as opaque bytes; what those bytes *are* is a client convention. furden's unit of content is a **post** — body text plus zero or more images — serialised into a single plaintext envelope, encrypted as **one blob** with **one fingerprint**. One post is therefore one upload, one `registerContent` transaction, one rate-limit unit, and one size-limit budget.

**Envelope v1 — byte layout:**

```
offset      size       field
0           4          magic: ASCII "DENP"
4           1          version: 0x01
5           4          headerLen: uint32, big-endian
9           headerLen  header: UTF-8 JSON (shape below)
9+headerLen ...        image payloads: raw bytes, concatenated in header order
```

**Header JSON:**

```json
{
  "text": "post body — plain text, may be empty",
  "images": [
    { "len": 123456, "type": "image/png", "w": 1920, "h": 1080 }
  ]
}
```

- `images[].len` — exact byte length of that image's payload. Image payloads appear after the header in array order; offsets are the cumulative sums. `images` may be empty (text-only post).
- `images[].type` — MIME type, used for the object URL at render time.
- `images[].w` / `images[].h` — pixel dimensions, captured at compose time. These let cards reserve correct layout (the clamped aspect-ratio rules) before image decode — no layout shift.
- Image bytes are **raw** — never base64 (a JSON-embedded encoding would inflate the size budget ~33%).

**Validation on parse** (failures render the "content could not be decrypted" error card, same path as a decryption failure):

1. `magic == "DENP"`, `version == 0x01` (unknown versions are an error, not a guess)
2. `9 + headerLen ≤ plaintext.length`; header parses as JSON with the shape above
3. `9 + headerLen + Σ images[].len == plaintext.length` — the envelope accounts for every byte

**Size budget:** plaintext envelope size is `9 + headerLen + Σ image bytes`; encryption adds exactly 28 bytes (12-byte nonce + 16-byte tag). The composer enforces `envelopeSize + 28 ≤ post_size_limit(trustTier)` before encrypting. Per-file caps and a maximum image count are client composer policy, not protocol rules — the instance sees only total ciphertext bytes (it cannot see inside the envelope, by design: file count and per-image sizes are metadata the hoster never learns).

**What stays outside the envelope:** content warnings travel as instance metadata (`X-Warnings` header) — they must be readable *without* the content key, because locked and blurred teaser cards render warnings to non-subscribers. Tier and timestamp are likewise instance/chain metadata.

The envelope applies identically to paywalled posts (tier-derived key) and public posts (fresh random key, `X-Tier-Id: 0`).

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

The operational blob is encrypted to the instance's public key (step 3). The portability and emergency blobs are encrypted to *wallet* public keys — but an injected browser wallet (MetaMask, Rabby, Coinbase Wallet) exposes neither its private key nor its public key, only the ability to sign. Recover the wallet's secp256k1 public key from a signature: have the wallet sign a fixed message, then recover the public key from that signature.

```ts
import { recoverPublicKey, hashMessage, toBytes } from 'viem';

// Recover a wallet's secp256k1 public key by having it sign a fixed message.
// Injected wallets never expose the key directly — this is the only way to obtain it
// client-side. The message content is irrelevant to the math; keep it stable and explain
// it to the user (it is what lets DEN encrypt a recovery copy of their keys back to them).
async function recoverWalletPubKey(
  signMessageAsync: (args: { message: string }) => Promise<`0x${string}`>,
): Promise<Uint8Array> {
  const message   = 'DEN: reveal public key to encrypt a recovery copy of your keys to this wallet';
  const signature = await signMessageAsync({ message });
  const pubKeyHex = await recoverPublicKey({ hash: hashMessage(message), signature });
  return toBytes(pubKeyHex); // 65-byte uncompressed point (0x04…); @noble accepts it as a recipient key
}

// Operational blob — encrypted to the instance pubKey from step 3
const instancePubKey  = fromHex(blobPubkeyResponse.pubKey, 'bytes');
const operationalBlob = await encryptBlob(masterSecret, instancePubKey);

// Portability blob — encrypted to the connected (primary) wallet's recovered pubkey
const walletPubKey    = await recoverWalletPubKey(signMessageAsync);
const portabilityBlob = await encryptBlob(masterSecret, walletPubKey);

// Emergency portability blob — only when an emergency wallet is registered.
// The emergency wallet's pubkey is recovered the same way *when that wallet is connected*
// during its registration in settings (it is a different wallet, generally not connected
// during onboarding), or recovered from a prior on-chain signature it has produced.
const emergencyPortabilityBlob = await encryptBlob(masterSecret, emergencyWalletPubKey);
```

> **Portability-blob limitation (v1.x).** The portability blob can be *written* with only a signature (above), but *reading* it back — decrypting during migration — requires the wallet's private key for the reverse ECDH, which an injected wallet never exposes. Decrypting it in-browser therefore needs a wallet that can export its key, or an out-of-band key import; migration UI is v1.x (DESIGN.md). For everyday session restore this no longer matters: the client recovers the master secret from its **current** instance via `GET /creator/master-secret` (see "Master secret session recovery" below). The portability blob remains the instance-independent escape hatch — it is what makes leaving a dead or hostile instance possible.

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

**7. Set instance URL on-chain [instance + chain]** *(if not already set)*

A non-empty instance URL requires a countersignature from the receiving instance's primary wallet — the instance's on-chain confirmation that it hosts this creator. Fetch it, then pass all three values through to the contract:

```
GET /creator/url-signature
→ { url, receivingInstanceProxy, instanceSig, nonce }

DENIdentityImpl.updateInstanceURL(url, receivingInstanceProxy, instanceSig)
```

Called from the creator's proxy's registered wallet (the proxy address is the contract address). The signature covers `keccak256(abi.encode("DEN-url-confirm", creatorProxy, url, urlUpdateNonce))` as an EIP-191 personal message and commits to the proxy's current `urlUpdateNonce`, so it is valid for exactly one call — re-fetch if the transaction is not sent promptly after another URL update. Required for client-side routing — compliant clients resolve creator identity via the on-chain instance URL record.

---

## Master secret session recovery

The master secret is memory-only client-side — any full page load loses it, and the portability blob cannot restore it in-browser (see the callout above). The instance fills this gap: an authenticated creator can retrieve their own decrypted operational payload.

```
GET /creator/master-secret
→ { masterSecret: "0x<64 hex>" }   (32 bytes)
```

404 if no operational blob is stored for the session's proxy (the wallet is not a creator on this instance, or setup is incomplete).

**Trust analysis.** This endpoint adds zero new exposure. The instance already derives the per-creator blob key and decrypts this exact blob on every subscriber key request (`POST /access/key`) — the plaintext master secret transits the instance process routinely today. Wire delivery as hex over the authenticated TLS channel is the same class as key delivery returning derived content keys to subscribers. The only change is *who may ask*: the creator, for their own secret, on a session bound to a registry-authorized wallet (`/auth/verify` resolves wallet → proxy on-chain). It does not weaken the E2EE stance either — that stance is subscriber-facing (the *hoster* cannot read content without the instance master key); creators have always trusted their chosen instance with operational key derivation.

**Client obligations:**

- Call it only when needed: after a successful sign-in, when `isCreator` is true and no master secret is in memory. Never poll.
- Treat the response like the master secret it is: memory only, never persisted, wiped on disconnect/unload — identical discipline to a freshly generated secret.
- Recovery failure is non-fatal: degrade to the locked-preview creator experience and let the user retry by signing in again.

---

## Content posting

**1. Set up a subscription tier [chain]**
```
DENSubscription.setTier(tierId, price, duration, token)
```
`price` in wei, `duration` in seconds, `token` is ERC-20 address or `address(0)` for ETH.

**2. Build the post envelope and encrypt [client]**

`plaintext` is the serialised post envelope — text + images in one blob; see "Post envelope (content plaintext format)". This is the paywalled path — the key is tier-derived. For content posted as **public**, substitute a fresh random key (`crypto.getRandomValues(new Uint8Array(32))`) for `tierKey` and use `X-Tier-Id: 0` in step 3; see "Mark content public or private" for why a tier key must never be published.

```ts
const plaintext  = buildEnvelope(text, images);   // src/lib/envelope.ts
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

Public content is served without a subscription — the content key is included in `GET /profile/:proxy` so any client can decrypt it.

```
PUT /creator/content/:fingerprint/visibility
Body: { isPublic: true,  contentKey: "0x<64 hex chars>" }
   or { isPublic: false }
→ { stored: true }
```

`contentKey` **MUST be a fresh random per-post key** (`crypto.getRandomValues(new Uint8Array(32))`), generated when the content is encrypted for public posting. It MUST NOT be a derivation-path key: publishing `deriveKey(masterSecret, "tier:" + tierId)` would unlock every post in that tier for any authenticated participant, since private ciphertext is served on auth alone and paywalled fingerprints are enumerable on-chain (`ContentRegistered` events). The instance stores whatever key it is given — derivation discipline is the client's responsibility.

**Posting as public from the start:** encrypt with a fresh random key, upload with `X-Tier-Id: 0` (the no-tier convention for content that is not tier-gated; the header is mandatory), then mark public with that key. Tier ID `0` is reserved for this — compliant clients number real subscription tiers from `1` and never call `setTier` with `0`.

**Visibility changes are re-encryption events**, because the key a blob was encrypted with cannot be swapped after the fact:

- *Paywalled → public:* re-encrypt the plaintext with a fresh random key, upload (new fingerprint), register the new fingerprint on-chain, mark it public, then delete the old row (`DELETE /creator/content/:fingerprint`) and archive the old fingerprint (`DENContentRegistry.archiveContent`).
- *Public → paywalled:* the same flow in reverse — re-encrypt with the tier key, upload, register, then remove the public row. `isPublic: false` alone only clears the stored key; the old key was already published, so the old ciphertext must be treated as permanently disclosed. Clients must present this honestly: making a post private again protects nothing that was public before.

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
DENSubscription.subscribe(creatorProxy, tierId)   // payable
```

The token and price come from the tier definition (`TierSet` / `getTierToken`), not from the call. For ERC-20 tiers, `approve` `DENSubscription` for the tier price first and send no value. For ETH tiers (`token == address(0)`), send the tier price as `msg.value`.

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

**6. Update the on-chain instance URL [instance + chain]**

The migration announcement IS the URL update — there is no separate announce call. The **new** instance countersigns its own URL (it must have `INSTANCE_PUBLIC_URL` configured and a registered operator wallet):

```
GET <newInstance>/creator/url-signature
→ { url, receivingInstanceProxy, instanceSig, nonce }

DENIdentityImpl.updateInstanceURL(url, receivingInstanceProxy, instanceSig)
```

This is the same flow as onboarding step 7, pointed at the new instance. Once the transaction confirms, compliant clients resolve this creator to the new instance.

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
| `DENIdentityRegistry` | `register()`, `isRegistered(wallet)`, `getProxy(wallet)`, `handleOf(proxy)`, `resolve(handle)` |
| `DENIdentityImpl` (call at the proxy address) | `updateInstanceURL(url, receivingInstanceProxy, instanceSig)`, `registerEmergencyWallet(wallet)`, `initiateCleanRotation(newWallet, newWalletSig)`, `initiateCompromiseRotation(newWallet)`, `instanceURL()`, `urlUpdateNonce()` |
| `DENSubscription` | `setTier(tierId, price, duration, token)`, `subscribe(creatorProxy, tierId)` — payable; send `msg.value` for ETH tiers, ERC-20 tiers require `approve` on the token first |
| `DENContentRegistry` | `registerContent(fingerprint, tierId)` |
| `DENAccessGrant` | `publishGrant(tierId, paths, signature)` |
| `DENPurchaseState` | `purchase(creatorProxy, listingId)` — payable, same token pattern as `subscribe` (v1.x, shop) |
| `DENReportRegistry` | `fileReport(contentProxy, fingerprint, violationType, evidenceHash)` |

ABIs are in `den-protocol/abis.ts` — the single source of truth for both the instance and furden. Import from there rather than writing from scratch.
