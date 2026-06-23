/**
 * Content posting pipeline — PROTOCOL.md "Content posting" + furden-architecture.md §8.
 *
 * The phase transitions and retry orchestration live in the composer route; this module holds the
 * individual phase operations so they stay pure-ish and reusable. Chain ops go through
 * wagmi/actions + wagmiConfig (the lib/price.ts / lib/onboarding.ts pattern).
 *
 * This is the PUBLIC-post path: a fresh random per-post key (never a derivation-path key — that
 * would unlock the whole tier, PROTOCOL.md "Mark content public or private"), uploaded with the
 * reserved X-Tier-Id: 0, then marked public with that key. The paywalled path (tier-derived key +
 * access grant) lands with tier management.
 */
import { keccak256, encodeAbiParameters, type Address } from 'viem'
import { readContract, writeContract, waitForTransactionReceipt } from 'wagmi/actions'
import { wagmiConfig } from './wagmi'
import { creator as creatorApi, ApiError } from './api'
import { randomContentKey, deriveKey, tierPath, encryptContent, keyToHex } from './crypto'
import { buildEnvelope, GCM_OVERHEAD, type EnvelopeImage } from './envelope'
import { contentRegistryAbi, accessGrantAbi } from './abis'
import { getContracts } from './chain'
import { env } from './env'
import type { GovernanceParams } from '@/stores/governance'

/** A wallet signer over a pre-hashed message (the access-grant struct hash). */
type SignRaw = (args: { message: { raw: `0x${string}` } }) => Promise<`0x${string}`>

function assertWithinLimit(plaintextLen: number, maxBytes: number): void {
  // The only protocol-enforced size constraint is total blob bytes (envelope + GCM overhead).
  if (plaintextLen + GCM_OVERHEAD > maxBytes) {
    throw new Error(
      `This post is ${(plaintextLen / 1_048_576).toFixed(1)} MB, over the ${(
        maxBytes / 1_048_576
      ).toFixed(0)} MB limit. Remove an image or shorten the text.`,
    )
  }
}

/** Reserved tier id for content that is not tier-gated (PROTOCOL.md). */
export const PUBLIC_TIER_ID = 0

const DEFAULT_POST_SIZE_LIMIT = 10 * 1024 * 1024 // 10 MiB — matches the conservative governance default

/**
 * The most conservative post size limit: the lowest trust tier's `post_size_limit`. A creator's
 * real allowance is at least this, so enforcing it never lets through a blob too large for the
 * floor. Falls back to 10 MiB when the governance params are absent or malformed.
 */
export function postSizeLimit(params: GovernanceParams | null): number {
  const tiers = params?.['trust_tiers']
  const limits =
    tiers && typeof tiers === 'object'
      ? (tiers as Record<string, unknown>)['post_size_limits']
      : undefined
  const t0 =
    limits && typeof limits === 'object'
      ? (limits as Record<string, unknown>)['tier_0']
      : undefined
  const n = typeof t0 === 'string' || typeof t0 === 'number' ? Number(t0) : NaN
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_POST_SIZE_LIMIT
}

/**
 * Phase 1 — build the envelope, size-check it, and encrypt with a fresh random key.
 * Returns the ciphertext blob (nonce-prefixed) and the per-post key.
 */
export async function buildPublicCiphertext(
  text: string,
  images: EnvelopeImage[],
  maxBytes: number,
): Promise<{ ciphertext: Uint8Array; key: Uint8Array }> {
  const plaintext = buildEnvelope(text, images)
  assertWithinLimit(plaintext.length, maxBytes)
  const key = randomContentKey()
  const ciphertext = await encryptContent(key, plaintext)
  return { ciphertext, key }
}

/**
 * Phase 1 (paywalled) — build the envelope and encrypt with the tier-derived key. No per-post key
 * is returned: the key is re-derivable from the master secret, and it is NEVER published (a tier
 * key unlocks the whole tier). Requires the master secret in memory (present only in the session
 * it was generated — there is no in-browser recovery in v1; PROTOCOL.md step 5 note).
 */
export async function buildPaywalledCiphertext(
  text: string,
  images: EnvelopeImage[],
  masterSecret: Uint8Array,
  tierId: number,
  maxBytes: number,
): Promise<Uint8Array> {
  const plaintext = buildEnvelope(text, images)
  assertWithinLimit(plaintext.length, maxBytes)
  const key = deriveKey(masterSecret, tierPath(tierId))
  return encryptContent(key, plaintext)
}

/** Phase 2 — upload ciphertext. The instance computes the fingerprint (SHA-256 of the bytes). */
export async function uploadPost(
  ciphertext: Uint8Array,
  tierId: number,
  warnings?: string[],
): Promise<string> {
  const { fingerprint } = await creatorApi.uploadContent(ciphertext, tierId, warnings)
  return fingerprint
}

/** Phase 3a — register the fingerprint on-chain so it is discoverable (ContentRegistered event). */
export async function registerContentOnChain(fingerprint: string, tierId: number): Promise<void> {
  const hash = await writeContract(wagmiConfig, {
    address: getContracts(env.chainId).contentRegistry,
    abi: contentRegistryAbi,
    functionName: 'registerContent',
    args: [fingerprint as `0x${string}`, BigInt(tierId)],
  })
  await waitForTransactionReceipt(wagmiConfig, { hash })
}

/** Phase 3b (public) — publish the per-post key so any client can decrypt this public post. */
export async function markPublic(fingerprint: string, key: Uint8Array): Promise<void> {
  await creatorApi.setVisibility(fingerprint, { isPublic: true, contentKey: keyToHex(key) })
}

const GRANT_HASH_PARAMS = [
  { type: 'string' },
  { type: 'address' },
  { type: 'uint256' },
  { type: 'bytes32' },
  { type: 'uint256' },
] as const

function pathsEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((p, i) => p === b[i])
}

/**
 * Phase 3b (paywalled) — ensure the tier's access grant authorises the `tier:N` derivation path in
 * BOTH stores: the instance (which releases the tier key to subscribers) and the on-chain
 * DENAccessGrant (which the access gate verifies). PROTOCOL.md "Content posting" step 5, §8 Phase 3
 * sub-step B.
 *
 * The grant version is governed by the INSTANCE: POST /creator/grant requires `version` to equal
 * its stored version + 1 (or 1 when absent), so the version is read from `GET /creator/grant/:tierId`,
 * not from the chain — otherwise a retry after the instance stored a grant but the chain tx failed
 * would recompute version 1 forever and deadlock on a 409. The two sides are reconciled
 * independently so a partial failure on either is recoverable: each is written only if it does not
 * already hold exactly this grant.
 */
export async function ensureAccessGrant(
  creatorProxy: Address,
  tierId: number,
  signRaw: SignRaw,
): Promise<void> {
  const paths = [tierPath(tierId)] // e.g. ['tier:1']
  const accessGrant = getContracts(env.chainId).accessGrant

  // Instance state (its version counter governs putGrant).
  let instanceGrant: { paths: string[]; version: number } | null
  try {
    instanceGrant = await creatorApi.getGrant(tierId)
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) instanceGrant = null
    else throw e
  }
  const instanceCovers = !!instanceGrant && pathsEqual(instanceGrant.paths, paths)

  // On-chain state (authoritative for the access gate).
  const onChain = await readContract(wagmiConfig, {
    address: accessGrant,
    abi: accessGrantAbi,
    functionName: 'getGrant',
    args: [creatorProxy, BigInt(tierId)],
  })
  const onChainCovers = onChain.exists && pathsEqual(onChain.derivationPaths, paths)

  if (instanceCovers && onChainCovers) return // fully published

  // Reuse the existing version when the instance already holds these paths (we only need to catch
  // the chain up); a path change bumps to the next version; a brand-new grant starts at 1.
  const version = instanceGrant ? instanceGrant.version + (instanceCovers ? 0 : 1) : 1

  const pathsHash = keccak256(encodeAbiParameters([{ type: 'string[]' }] as const, [paths]))
  const structHash = keccak256(
    encodeAbiParameters(GRANT_HASH_PARAMS, [
      'DEN-access-grant',
      creatorProxy,
      BigInt(tierId),
      pathsHash,
      BigInt(version),
    ]),
  )
  const signature = await signRaw({ message: { raw: structHash } })

  if (!instanceCovers) {
    await creatorApi.putGrant(String(tierId), paths, signature, version)
  }
  if (!onChainCovers) {
    const hash = await writeContract(wagmiConfig, {
      address: accessGrant,
      abi: accessGrantAbi,
      functionName: 'publishGrant',
      args: [BigInt(tierId), paths, signature],
    })
    await waitForTransactionReceipt(wagmiConfig, { hash })
  }
}
