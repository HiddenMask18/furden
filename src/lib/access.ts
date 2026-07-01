/**
 * Access-grant inspection — PROTOCOL.md "Access grant signing", furden-architecture.md §8 Phase 3b.
 *
 * A tier's grant authorises a set of derivation paths and lives in TWO stores that must agree: the
 * on-chain DENAccessGrant (which the access gate verifies) and the instance (which releases the tier
 * key to subscribers). The composer publishes both when a creator first posts paywalled content
 * (lib/posting.ts ensureAccessGrant); this module reads them back so the studio can show whether a
 * tier is fully published, and surface a partial state a repair can fix.
 *
 * In v1 each tier grants exactly one path, `tier:N` (parallel tiers, no hierarchy), so "covered"
 * means the stored paths equal `['tier:N']`.
 */
import type { Address } from 'viem'
import { readContract } from 'wagmi/actions'
import { wagmiConfig } from './wagmi'
import { creator as creatorApi, ApiError } from './api'
import { accessGrantAbi } from './abis'
import { tierPath } from './crypto'
import { getContracts } from './chain'
import { env } from './env'

export type GrantStatus = 'published' | 'chain-only' | 'instance-only' | 'none'

export type GrantState = {
  tierId: number
  onChain: { exists: boolean; paths: readonly string[]; version: number }
  instance: { paths: string[]; version: number } | null
  status: GrantStatus
}

function pathsEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((p, i) => p === b[i])
}

/** Read a tier's grant from both stores and classify how completely it is published. */
export async function readGrantState(creatorProxy: Address, tierId: number): Promise<GrantState> {
  const expected = [tierPath(tierId)]

  const onChainRaw = await readContract(wagmiConfig, {
    address: getContracts(env.chainId).accessGrant,
    abi: accessGrantAbi,
    functionName: 'getGrant',
    args: [creatorProxy, BigInt(tierId)],
  })
  const onChain = {
    exists: onChainRaw.exists,
    paths: onChainRaw.derivationPaths,
    version: Number(onChainRaw.version),
  }

  let instance: { paths: string[]; version: number } | null
  try {
    const g = await creatorApi.getGrant(tierId)
    instance = { paths: g.paths, version: g.version }
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) instance = null
    else throw e
  }

  const onChainCovers = onChain.exists && pathsEqual(onChain.paths, expected)
  const instanceCovers = instance != null && pathsEqual(instance.paths, expected)

  const status: GrantStatus =
    onChainCovers && instanceCovers
      ? 'published'
      : onChainCovers
        ? 'chain-only'
        : instanceCovers
          ? 'instance-only'
          : 'none'

  return { tierId, onChain, instance, status }
}
