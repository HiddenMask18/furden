/**
 * Visibility changes — PROTOCOL.md "Visibility changes are re-encryption events" +
 * furden-architecture.md §8.
 *
 * A blob's key cannot be swapped after the fact, so moving a post between public and paywalled is
 * NOT a metadata flip: it is a re-encryption. Decrypt the old ciphertext with its current key,
 * re-encrypt the SAME plaintext with the key the target visibility requires (a fresh random key for
 * public — never a derivation-path key, that would unlock the whole tier — or the tier-derived key
 * for paywalled), upload it as a new fingerprint, register it on-chain, publish it (mark public, or
 * ensure the tier's access grant), then remove the old copy (delete the instance row + archive the
 * old fingerprint on-chain).
 *
 * Going private again does NOT un-publish what was public: the old key was already disclosed. The
 * caller must present that honestly — this pipeline only governs future access.
 *
 * Both directions need the master secret for the tier-key side, so the whole action is gated on it
 * being in memory (present only in the session it was generated; there is no in-browser recovery in
 * v1). The `progress` object is mutated in place and passed back on retry so a re-run skips steps
 * that already succeeded and never orphans a second copy.
 */
import type { Address } from 'viem'
import { readContract, writeContract, waitForTransactionReceipt } from 'wagmi/actions'
import { content as contentApi, creator as creatorApi, ApiError } from './api'
import {
  decryptContent,
  encryptContent,
  deriveKey,
  tierPath,
  randomContentKey,
  keyFromHex,
  keyToHex,
} from './crypto'
import {
  uploadPost,
  registerContentOnChain,
  markPublic,
  ensureAccessGrant,
  PUBLIC_TIER_ID,
} from './posting'
import { wagmiConfig } from './wagmi'
import { contentRegistryAbi } from './abis'
import { getContracts } from './chain'
import { env } from './env'

type SignRaw = (args: { message: { raw: `0x${string}` } }) => Promise<`0x${string}`>

export type VisibilityTarget = { kind: 'public' } | { kind: 'paywalled'; tierId: number }

/** Coarse phase for the progress UI (the finer step guards live in the `progress` object). */
export type VisibilityPhase =
  | 'reencrypt'
  | 'upload'
  | 'register'
  | 'publish'
  | 'cleanup'
  | 'done'

/** Mutated in place so a retry resumes rather than orphaning a second copy. */
export type VisibilityProgress = {
  newFingerprint?: string
  newPublicKeyHex?: `0x${string}` // the fresh random key, when the target is public
  registered?: boolean
  published?: boolean
  removedOld?: boolean
}

export type ChangeVisibilityArgs = {
  creatorProxy: Address
  oldFingerprint: string
  oldTierId: number
  oldIsPublic: boolean
  /** Required when the old post is public: the per-post key from the profile, to decrypt it. */
  oldPublicKeyHex?: string
  warnings: string[] | null
  masterSecret: Uint8Array
  target: VisibilityTarget
  signRaw: SignRaw
  onPhase?: (phase: VisibilityPhase) => void
}

function oldKeyBytes(args: ChangeVisibilityArgs): Uint8Array {
  if (args.oldIsPublic) {
    if (!args.oldPublicKeyHex) throw new Error('The public key for this post is missing.')
    return keyFromHex(args.oldPublicKeyHex)
  }
  return deriveKey(args.masterSecret, tierPath(args.oldTierId))
}

/**
 * Run (or resume) a visibility change. Returns the new fingerprint. Safe to call again with the
 * same `progress` after a failure — completed steps are skipped.
 */
export async function changeVisibility(
  args: ChangeVisibilityArgs,
  progress: VisibilityProgress,
): Promise<string> {
  const { target, onPhase } = args
  const targetTierId = target.kind === 'public' ? PUBLIC_TIER_ID : target.tierId

  // 1. Re-encrypt: decrypt the old blob and encrypt the plaintext under the target key, then upload
  //    as a new fingerprint. Guarded together so a retry never produces a third fingerprint.
  if (!progress.newFingerprint) {
    onPhase?.('reencrypt')
    const oldCiphertext = args.oldIsPublic
      ? await contentApi.downloadPublic(args.oldFingerprint)
      : await contentApi.download(args.oldFingerprint)
    const plaintext = await decryptContent(oldKeyBytes(args), oldCiphertext)

    let newKey: Uint8Array
    if (target.kind === 'public') {
      newKey = randomContentKey()
      progress.newPublicKeyHex = keyToHex(newKey)
    } else {
      newKey = deriveKey(args.masterSecret, tierPath(targetTierId))
    }
    const newCiphertext = await encryptContent(newKey, plaintext)

    onPhase?.('upload')
    progress.newFingerprint = await uploadPost(
      newCiphertext,
      targetTierId,
      args.warnings ?? undefined,
    )
  }

  // 2. Register the new fingerprint on-chain.
  if (!progress.registered) {
    onPhase?.('register')
    await registerContentOnChain(progress.newFingerprint, targetTierId)
    progress.registered = true
  }

  // 3. Publish: hand the random key to the instance (public), or ensure the tier grant (paywalled).
  if (!progress.published) {
    onPhase?.('publish')
    if (target.kind === 'public') {
      await markPublic(progress.newFingerprint, keyFromHex(progress.newPublicKeyHex!))
    } else {
      await ensureAccessGrant(args.creatorProxy, target.tierId, args.signRaw)
    }
    progress.published = true
  }

  // 4. Remove the old copy: delete the instance row (404 = already gone) and archive the old
  //    fingerprint on-chain (skipped when it is no longer active, so a retry can't revert).
  if (!progress.removedOld) {
    onPhase?.('cleanup')
    try {
      await creatorApi.deleteContent(args.oldFingerprint)
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) throw e
    }
    const registry = getContracts(env.chainId).contentRegistry
    const active = await readContract(wagmiConfig, {
      address: registry,
      abi: contentRegistryAbi,
      functionName: 'isContentActive',
      args: [args.oldFingerprint as `0x${string}`],
    })
    if (active) {
      const hash = await writeContract(wagmiConfig, {
        address: registry,
        abi: contentRegistryAbi,
        functionName: 'archiveContent',
        args: [args.oldFingerprint as `0x${string}`],
      })
      await waitForTransactionReceipt(wagmiConfig, { hash })
    }
    progress.removedOld = true
  }

  onPhase?.('done')
  return progress.newFingerprint
}
