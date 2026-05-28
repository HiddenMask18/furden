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

Store `sessionToken` in memory (Zustand), never in localStorage. The `proxy` is the creator's stable DEN identity — it does not change on wallet rotation. Use it as the key for all subsequent operations.

All protected routes: `Authorization: Bearer <sessionToken>`

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

// Emergency portability blob — if an emergency wallet is registered
const emergencyPortabilityBlob = await encryptBlob(masterSecret, emergencyWalletPubKey);
```

**6. Upload blobs [instance]**
```
PUT /creator/blob
Body: {
  operationalBlob:          "0x<hex>",
  portabilityBlob:          "0x<hex>",
  emergencyPortabilityBlob: "0x<hex>"   // optional
}
→ { stored: true }
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

`contentKey` in `publicContent` entries is the 32-byte AES key. To display public content:
1. `GET /content/:fingerprint` (no auth needed for public-designated content)
2. Decrypt: extract 12-byte nonce from `ciphertext[0..12]`, decrypt `ciphertext[12..]` with the key

`contentWarnings` covers paywalled posts — metadata only, no key or ciphertext.

---

## Subscriber flow

**1. Subscribe on-chain [chain]**
```
DENSubscription.subscribe(creatorProxy, tierId, token, amount)
```

For ERC-20 tokens, approve `DENSubscription` for `amount` first. For ETH, pass `address(0)` as token and send value with the call.

**2. Authenticate with the instance [instance]**

Same auth flow as creator. The subscriber's session is keyed to their proxy.

**3. Request content key [instance]**
```
POST /access/key
Body: { type: "subscription", creatorProxy: "0x...", tierId: "1" }
   or { type: "purchase",     creatorProxy: "0x...", listingId: "42" }
→ { keys: { "tier:1": "0xabc...", "tier:2": "0xdef..." } }
```

The instance verifies on-chain entitlement live (no cache). If the subscription has lapsed or the fingerprint is suspended, the request fails. Multiple keys may be returned if the creator's access grant covers multiple tiers.

**4. Download ciphertext [instance]**
```
GET /content/:fingerprint
Authorization: Bearer <sessionToken>
→ <ciphertext bytes>
```

**5. Decrypt content [client]**
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
   - `DELETE /creator/content/:fingerprint` (old)

**After all tiers complete:**

- Generate new blobs for all registered wallets (same ECIES process as onboarding, using `newMasterSecret`)
- `PUT /creator/blob` with new operational, portability, and emergency blobs

**Resumability:** on restart, diff the on-chain fingerprints against `GET /creator/content`. Tiers where all on-chain fingerprints match the instance DB are complete; tiers with mismatches are incomplete. Resume from the first incomplete tier.

---

## Migration (moving to a new instance)

**Export from old instance:**
```
GET /creator/export
→ {
    portabilityBlob: "0x...",
    content: [{ fingerprint, tierId, warnings, timestamp }],
    grants:  [{ tierId, paths, version, signature }]
  }
```

**Import to new instance:**

1. Authenticate with the new instance
2. `GET /creator/blob-pubkey` on the new instance
3. Decrypt the portability blob with the creator's wallet private key → recover `masterSecret`
4. Encrypt to the new instance's blob public key → new `operationalBlob`
5. `PUT /creator/blob { operationalBlob, portabilityBlob }` on the new instance
6. `POST /creator/import` with the export bundle
7. Update the on-chain instance URL: `DENIdentityImpl.setInstanceUrl(newInstanceUrl)` [chain]
8. Re-upload content ciphertext (the bundle contains fingerprints but not ciphertext — content bytes come from IPFS or manual re-upload)

**Announce migration on-chain [chain]:**
```
DENIdentityImpl.announceInstanceMigration(newInstanceUrl, operatorCounterSignature)
```

---

## Governance parameters

Live on-chain values that affect client behaviour. Fetch at startup or when needed — values can be updated by governance.

```
GET /governance/params
→ { identity, content, compensation, trust_tiers, reporting, fees, misc }
```

Key values the client cares about:
- `identity.wallet_rotation_delay` — delay window for compromise rotation (show to user)
- `content.subscriber_protection_window` — how long subscribers retain access after sunset notice
- `trust_tiers.post_size_limits` / `post_rate_limits` — enforce before attempting upload to avoid 413/429
- `fees.protocol_fee_bps` — show the 2.5% protocol fee in subscription pricing UI

All numeric values are strings (BigInt serialisation). `post_rate_limits.tier_3` is `"unlimited"`.

---

## On-chain contract reference

All contracts are on Base (mainnet) / Base Sepolia (testnet). Addresses come from the instance operator's deployment — fetch them or configure them in `VITE_*` env vars.

| Contract | Key client calls |
|---|---|
| `DENIdentityRegistry` | `register()`, `getProxy(wallet)`, `handleOf(proxy)` |
| `DENIdentityImpl` (via proxy) | `setInstanceUrl(url)`, `addEmergencyWallet(wallet)`, `initiateCleanRotation(...)`, `initiateCompromiseRotation(newWallet)` |
| `DENSubscription` | `setTier(tierId, price, duration, token)`, `subscribe(creatorProxy, tierId, token, amount)` |
| `DENContentRegistry` | `registerContent(fingerprint, tierId)` |
| `DENAccessGrant` | `publishGrant(tierId, paths, signature)` |
| `DENPurchaseState` | `purchase(creatorProxy, listingId, token, amount)` |
| `DENReportRegistry` | `fileReport(contentProxy, fingerprint, violationType, evidenceHash)` |

ABI slices are in `den-protocol/instance/src/chain/abis.ts` — copy or reference them rather than writing from scratch.
