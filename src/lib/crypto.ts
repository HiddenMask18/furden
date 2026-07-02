/**
 * Client-side cryptography — PROTOCOL.md §"Client-side cryptography".
 *
 * ALL cryptography in DEN is client-side. The master secret never leaves the browser in
 * plaintext. This module is the only place that touches key material; the crypto store holds
 * it, this module operates on it. Matches the instance's scheme exactly:
 *   - ECIES (secp256k1 ECDH + HKDF-SHA256 + AES-256-GCM) for master-secret blobs
 *   - HKDF-SHA256 content-key derivation
 *   - AES-256-GCM content encryption, 12-byte prepended nonce
 */
import { secp256k1 } from '@noble/curves/secp256k1'
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha256'
import { recoverPublicKey, hashMessage, toBytes, fromHex, toHex } from 'viem'

const BLOB_INFO = new TextEncoder().encode('den-blob-v1')

/** Generate a fresh 32-byte master secret. Hold in memory only. */
export function generateMasterSecret(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32))
}

/** A fresh random 32-byte key for a PUBLIC post — NEVER a derivation-path key (PROTOCOL.md). */
export function randomContentKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32))
}

/**
 * Derive a content key from the master secret. The subscriber never runs this (the instance
 * does, server-side); creators run it when posting paywalled content.
 *   key = HKDF-SHA256(ikm=masterSecret, salt=none, info=path, length=32)
 * Paths: "tier:" + tierId  |  "item:" + listingId
 */
export function deriveKey(masterSecret: Uint8Array, path: string): Uint8Array {
  return hkdf(sha256, masterSecret, new Uint8Array(0), new TextEncoder().encode(path), 32)
}

export function tierPath(tierId: number | string): string {
  return `tier:${tierId}`
}

export function itemPath(listingId: number | string): string {
  return `item:${listingId}`
}

// Web Crypto types BufferSource over `ArrayBuffer`, but @noble/hashes and TS 5.7's generic
// Uint8Array yield `Uint8Array<ArrayBufferLike>`. These bytes are always ArrayBuffer-backed at
// runtime (never SharedArrayBuffer), so narrowing to BufferSource here is sound and copy-free.
const ab = (b: Uint8Array): BufferSource => b as BufferSource

/**
 * ECIES — encrypt a payload (the master secret) to a recipient secp256k1 public key.
 * Wire format: [ephPub(33)][nonce(12)][ciphertext+tag].
 */
export async function encryptBlob(
  plaintext: Uint8Array,
  recipientPubKey: Uint8Array,
): Promise<Uint8Array> {
  const ephPriv = secp256k1.utils.randomPrivateKey()
  const ephPub = secp256k1.getPublicKey(ephPriv, true) // 33-byte compressed

  const rawShared = secp256k1.getSharedSecret(ephPriv, recipientPubKey) // 33-byte compressed point
  const aesKeyBytes = hkdf(sha256, rawShared.slice(1), ephPub, BLOB_INFO, 32) // strip prefix byte → x

  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const aesKey = await crypto.subtle.importKey('raw', ab(aesKeyBytes), { name: 'AES-GCM' }, false, [
    'encrypt',
  ])
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, ab(plaintext)),
  )

  const out = new Uint8Array(33 + 12 + ct.length)
  out.set(ephPub, 0)
  out.set(nonce, 33)
  out.set(ct, 45)
  return out
}

/**
 * Recover a wallet's secp256k1 public key from an existing EIP-191 personal-message signature.
 * Any signature the wallet has already produced (e.g. sign-in) reveals the public key — no
 * dedicated prompt needed.
 */
export async function pubKeyFromSignature(
  message: string,
  signature: `0x${string}`,
): Promise<Uint8Array> {
  const pubKeyHex = await recoverPublicKey({ hash: hashMessage(message), signature })
  return toBytes(pubKeyHex) // 65-byte uncompressed point (0x04…); @noble accepts it as a recipient key
}

/**
 * Recover a wallet's secp256k1 public key by prompting for a fresh signature. Injected wallets
 * expose neither the private nor the public key — recovery from a signature is the only
 * client-side way to obtain it (needed to write the portability/emergency blobs). Fallback path:
 * sign-in normally captures the pubkey from its own signature without this extra prompt.
 */
export async function recoverWalletPubKey(
  signMessageAsync: (args: { message: string }) => Promise<`0x${string}`>,
): Promise<Uint8Array> {
  const message =
    'DEN: reveal public key to encrypt a recovery copy of your keys to this wallet'
  const signature = await signMessageAsync({ message })
  return pubKeyFromSignature(message, signature)
}

/**
 * Encrypt content with a 32-byte AES-256-GCM key.
 * Output: [nonce(12)][ciphertext+tag]. The instance computes the fingerprint (SHA-256 of
 * these bytes) on upload — do NOT compute it client-side.
 */
export async function encryptContent(
  key: Uint8Array,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const aesKey = await crypto.subtle.importKey('raw', ab(key), { name: 'AES-GCM' }, false, ['encrypt'])
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, ab(plaintext)),
  )
  const out = new Uint8Array(12 + ct.length)
  out.set(nonce, 0)
  out.set(ct, 12)
  return out
}

/** Decrypt content. Throws on a wrong key or tampered ciphertext (AES-GCM auth tag). */
export async function decryptContent(
  key: Uint8Array,
  ciphertext: Uint8Array,
): Promise<Uint8Array> {
  const nonce = ciphertext.subarray(0, 12)
  const ct = ciphertext.subarray(12)
  const aesKey = await crypto.subtle.importKey('raw', ab(key), { name: 'AES-GCM' }, false, ['decrypt'])
  return new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ab(nonce) }, aesKey, ab(ct)),
  )
}

/** Hex helpers for moving keys to/from the instance API (0x-prefixed). */
export function keyToHex(key: Uint8Array): `0x${string}` {
  return toHex(key)
}
export function keyFromHex(hex: string): Uint8Array {
  return fromHex(hex as `0x${string}`, 'bytes')
}
