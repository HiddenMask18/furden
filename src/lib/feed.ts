/**
 * Client-side feed assembly — furden-architecture.md §9.
 *
 * The instance is not an index: a subscriber's subscriptions live on-chain. We enumerate them from
 * one `Subscribed` getLogs (mirroring lib/tiers.ts), read each subscription's authoritative current
 * expiry, resolve each creator to a home instance and keep only those on the configured instance
 * (single-instance v1; the rest are link-outs surfaced on /subscriptions), then per (creator, tier)
 * fetch the inventory and the tier key in parallel and decrypt. On-chain is the source of truth.
 */
import type { Address } from 'viem'
import { parseAbiItem } from 'viem'
import { getPublicClient, readContract } from 'wagmi/actions'
import { wagmiConfig } from './wagmi'
import { subscriptionAbi } from './abis'
import { getContracts, deployBlock } from './chain'
import { env } from './env'
import { content as contentApi, access as accessApi, profile as profileApi } from './api'
import { keyFromHex } from './crypto'
import { readInstanceUrl } from './onboarding'
import { useCryptoStore } from '@/stores/crypto'

export type Subscription = {
  creatorProxy: Address
  tierId: number
  expiresAt: bigint // authoritative current expiry (seconds), read live — not the event value
}

export type FeedItem = {
  creatorProxy: Address
  fingerprint: string
  tierId: number
  timestamp: number // Unix ms
  warnings: string[] | null
  key: Uint8Array
}

const SUBSCRIBED = parseAbiItem(
  'event Subscribed(address indexed subscriberProxy, address indexed creatorProxy, uint256 indexed tierId, uint256 expiresAt)',
)

const TIER_PATH_RE = /^tier:(\d+)$/

/**
 * Enumerate a subscriber's subscriptions with live expiry. One getLogs on the indexed
 * subscriberProxy returns every (creator, tier); re-subscribes are deduped keeping the latest, and
 * the current expiry is read from the contract (the event's expiresAt is only correct as of that
 * block). Used by both /feed and /subscriptions.
 */
export async function enumerateSubscriptions(subscriberProxy: Address): Promise<Subscription[]> {
  const client = getPublicClient(wagmiConfig)
  if (!client) throw new Error('No RPC client available.')

  const logs = await client.getLogs({
    address: getContracts(env.chainId).subscription,
    event: SUBSCRIBED,
    args: { subscriberProxy },
    fromBlock: deployBlock,
    toBlock: 'latest',
  })

  // Dedupe (creator, tier) keeping the latest log (ascending order → last wins).
  const byKey = new Map<string, { creatorProxy: Address; tierId: number }>()
  for (const log of logs) {
    const { creatorProxy, tierId } = log.args
    if (!creatorProxy || tierId == null) continue
    byKey.set(`${creatorProxy}:${tierId}`, { creatorProxy, tierId: Number(tierId) })
  }

  return Promise.all(
    [...byKey.values()].map(async ({ creatorProxy, tierId }) => {
      const expiresAt = await readContract(wagmiConfig, {
        address: getContracts(env.chainId).subscription,
        abi: subscriptionAbi,
        functionName: 'getSubscriptionExpiry',
        args: [subscriberProxy, creatorProxy, tierId === 0 ? 0n : BigInt(tierId)],
      })
      return { creatorProxy, tierId, expiresAt }
    }),
  )
}

export type CreatorSubscriber = {
  subscriberProxy: Address
  tierId: number
  expiresAt: bigint // from the latest Subscribed event — expiry only changes when a new event fires
}

/**
 * Enumerate a creator's subscribers from the indexed creatorProxy — the mirror of
 * `enumerateSubscriptions`, used by the studio dashboard for at-a-glance counts. Deduped by
 * (subscriber, tier) keeping the latest event; the event's expiresAt is authoritative here because
 * a subscription's expiry only moves when another Subscribed event fires (subscribe/renew), and a
 * plain lapse emits nothing. No per-subscriber live read, so this stays one getLogs even for a
 * creator with many subscribers.
 */
export async function enumerateCreatorSubscribers(
  creatorProxy: Address,
): Promise<CreatorSubscriber[]> {
  const client = getPublicClient(wagmiConfig)
  if (!client) throw new Error('No RPC client available.')

  const logs = await client.getLogs({
    address: getContracts(env.chainId).subscription,
    event: SUBSCRIBED,
    args: { creatorProxy },
    fromBlock: deployBlock,
    toBlock: 'latest',
  })

  const byKey = new Map<string, CreatorSubscriber>()
  for (const log of logs) {
    const { subscriberProxy, tierId, expiresAt } = log.args
    if (!subscriberProxy || tierId == null || expiresAt == null) continue
    byKey.set(`${subscriberProxy}:${tierId}`, {
      subscriberProxy,
      tierId: Number(tierId),
      expiresAt,
    })
  }
  return [...byKey.values()]
}

/** True when a creator's on-chain instance URL is the one this client is configured for (§9). */
export async function isOnConfiguredInstance(creatorProxy: Address): Promise<boolean> {
  try {
    return (await readInstanceUrl(creatorProxy)) === env.instanceUrl
  } catch {
    return false
  }
}

/**
 * Assemble the feed: active subscriptions on the configured instance → per (creator, tier)
 * inventory + tier key, PLUS each subscribed creator's public posts → decryptable items, newest
 * first. Public posts are tier 0, so the subscription-derived enumeration alone never sees them —
 * but a subscriber expects a creator they pay for to appear whole; the per-post key ships in the
 * public profile. Tier keys are cached for reuse. Requires an active session (the content/key
 * calls are authenticated; the profile call is not).
 */
export async function assembleFeed(subscriberProxy: Address): Promise<FeedItem[]> {
  const subs = await enumerateSubscriptions(subscriberProxy)
  const now = BigInt(Math.floor(Date.now() / 1000))
  const active = subs.filter((s) => s.expiresAt > now)

  const cache = useCryptoStore.getState()

  // Resolve each distinct creator to the configured instance once (a creator can appear via
  // several tiers). Off-instance creators are link-outs on /subscriptions, not feed errors.
  const creators = [...new Set(active.map((s) => s.creatorProxy))]
  const onInstance = new Set<Address>()
  await Promise.all(
    creators.map(async (c) => {
      if (await isOnConfiguredInstance(c)) onInstance.add(c)
    }),
  )

  const tierGroups = await Promise.all(
    active
      .filter((s) => onInstance.has(s.creatorProxy))
      .map(async (s) => {
        const [inventory, keyRes] = await Promise.all([
          contentApi.byCreator(s.creatorProxy, s.tierId),
          accessApi.subscriptionKey(s.creatorProxy, s.tierId),
        ])

        // Cache every derivation-path key the grant returned (a higher tier may cover lower paths).
        for (const [path, hex] of Object.entries(keyRes.keys)) {
          const m = TIER_PATH_RE.exec(path)
          if (m) cache.cacheContentKey(s.creatorProxy, Number(m[1]), keyFromHex(hex))
        }

        const items: FeedItem[] = []
        for (const c of inventory.content) {
          const key = cache.getContentKey(s.creatorProxy, Number(c.tierId))
          if (!key) continue // no key for this content's path — skip rather than show a broken card
          items.push({
            creatorProxy: s.creatorProxy,
            fingerprint: c.fingerprint,
            tierId: Number(c.tierId),
            timestamp: c.timestamp,
            warnings: c.warnings,
            key,
          })
        }
        return items
      }),
  )

  const publicGroups = await Promise.all(
    [...onInstance].map(async (creatorProxy) => {
      const p = await profileApi.get(creatorProxy)
      return p.publicContent.map((c): FeedItem => {
        const key = keyFromHex(c.contentKey)
        cache.cachePublicKey(c.fingerprint, key)
        return {
          creatorProxy,
          fingerprint: c.fingerprint,
          tierId: Number(c.tierId),
          timestamp: c.timestamp,
          warnings: c.warnings,
          key,
        }
      })
    }),
  )

  // Flatten, dedupe by fingerprint (a post seen via multiple tiers), newest first.
  const seen = new Set<string>()
  const merged: FeedItem[] = []
  for (const item of [...tierGroups.flat(), ...publicGroups.flat()]) {
    if (seen.has(item.fingerprint)) continue
    seen.add(item.fingerprint)
    merged.push(item)
  }
  merged.sort((a, b) => b.timestamp - a.timestamp)
  return merged
}
