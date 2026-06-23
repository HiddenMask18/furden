/**
 * Subscription tiers — PROTOCOL.md "Content posting" step 1, furden-architecture.md §9.
 *
 * A creator's tier set is read from on-chain `TierSet` events (price/duration/token carried
 * inline) rather than from the instance — on-chain is the authority (§9), and there is no direct
 * price getter, so the event is the only complete source. setTier creates or overwrites a tier.
 * Real tiers number from 1; tier 0 is reserved for public content.
 */
import type { Address } from 'viem'
import { parseAbiItem } from 'viem'
import { getPublicClient, writeContract, waitForTransactionReceipt } from 'wagmi/actions'
import { wagmiConfig } from './wagmi'
import { subscriptionAbi } from './abis'
import { getContracts, deployBlock } from './chain'
import { env } from './env'

export type Tier = {
  tierId: number
  price: bigint // token base units (wei for ETH)
  duration: bigint // seconds
  token: Address // ERC-20 address, or the ETH sentinel address(0)
}

const TIER_SET = parseAbiItem(
  'event TierSet(address indexed creatorProxy, uint256 indexed tierId, uint256 price, uint256 duration, address indexed token)',
)

/**
 * Read a creator's current tiers from `TierSet` logs — the newest definition per tierId. Mirrors
 * the §9 getLogs strategy: filtered on the indexed creatorProxy, scanned from the deployment block
 * (never 0 on a real chain). Public RPC range caps are a v1.x concern (chunk + concatenate then).
 */
export async function readTiers(creatorProxy: Address): Promise<Tier[]> {
  const client = getPublicClient(wagmiConfig)
  if (!client) throw new Error('No RPC client available.')

  const logs = await client.getLogs({
    address: getContracts(env.chainId).subscription,
    event: TIER_SET,
    args: { creatorProxy },
    fromBlock: deployBlock,
    toBlock: 'latest',
  })

  // Logs arrive in ascending block order, so the last write per tierId wins.
  const byTier = new Map<number, Tier>()
  for (const log of logs) {
    const { tierId, price, duration, token } = log.args
    if (tierId == null || price == null || duration == null || token == null) continue
    byTier.set(Number(tierId), { tierId: Number(tierId), price, duration, token })
  }
  return [...byTier.values()].sort((a, b) => a.tierId - b.tierId)
}

/** Create or overwrite a tier on-chain. */
export async function setTier(tier: Tier): Promise<void> {
  const hash = await writeContract(wagmiConfig, {
    address: getContracts(env.chainId).subscription,
    abi: subscriptionAbi,
    functionName: 'setTier',
    args: [BigInt(tier.tierId), tier.price, tier.duration, tier.token],
  })
  await waitForTransactionReceipt(wagmiConfig, { hash })
}

/** Humanise a duration in seconds for display (whole days where it divides evenly). */
export function formatDuration(seconds: bigint): string {
  const s = Number(seconds)
  if (s % 86400 === 0) {
    const days = s / 86400
    return `${days} day${days === 1 ? '' : 's'}`
  }
  if (s % 3600 === 0) {
    const hours = s / 3600
    return `${hours} hour${hours === 1 ? '' : 's'}`
  }
  return `${s} seconds`
}
