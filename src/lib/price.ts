/**
 * Approximate fiat price display — decentralized, via Chainlink feeds on Base (den-spec §3.5).
 *
 * The native token amount is always the source of truth and the actual charge; this module
 * only produces the optional "~$5" comprehension helper. A token with no Chainlink feed in
 * CHAINLINK_USD_FEEDS shows NO fiat figure — there is deliberately NO fallback to a centralized
 * price API (Appendix A, "Subscription price display"; resolved 2026-06-17). Reading an
 * aggregator on-chain is the same viem read pattern furden uses for ERC-20 symbol()/decimals().
 */
import type { Address } from 'viem'
import { formatUnits } from 'viem'
import { readContract } from 'wagmi/actions'
import { wagmiConfig } from './wagmi'
import { activeChainId, CHAINLINK_USD_FEEDS, ETH_SENTINEL } from './chain'

// Minimal Chainlink AggregatorV3Interface — NOT a DEN contract, so it lives here, not in abis.ts.
const aggregatorAbi = [
  {
    name: 'latestRoundData',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
  },
  { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
] as const

function feedFor(token: Address): Address | undefined {
  const feeds = CHAINLINK_USD_FEEDS[activeChainId] ?? {}
  return feeds[token.toLowerCase()]
}

/** True when a fiat helper can be shown for this token. */
export function hasFiatFeed(token: Address): boolean {
  return Boolean(feedFor(token))
}

/**
 * Read the token's USD price from its Chainlink feed. Returns null (silently) when there is no
 * feed for the token or the read fails — callers simply omit the "~$" figure. The ETH sentinel
 * (address(0)) is treated like any other entry keyed in the feed map.
 */
export async function fetchUsdPrice(token: Address): Promise<number | null> {
  const feed = feedFor(token === ETH_SENTINEL ? ETH_SENTINEL : token)
  if (!feed) return null
  try {
    const [round, decimals] = await Promise.all([
      readContract(wagmiConfig, { address: feed, abi: aggregatorAbi, functionName: 'latestRoundData' }),
      readContract(wagmiConfig, { address: feed, abi: aggregatorAbi, functionName: 'decimals' }),
    ])
    const answer = round[1] // int256, USD price scaled by `decimals`
    if (answer <= 0n) return null
    return Number(formatUnits(answer, decimals))
  } catch {
    return null
  }
}

/**
 * Approximate fiat for a token amount (in token base units / wei). Returns a "~$X.XX" string,
 * or null to omit. `tokenDecimals` is the ERC-20 decimals (18 for ETH).
 */
export async function approxFiat(
  amount: bigint,
  token: Address,
  tokenDecimals: number,
): Promise<string | null> {
  const usdPerToken = await fetchUsdPrice(token)
  if (usdPerToken == null) return null
  const tokens = Number(formatUnits(amount, tokenDecimals))
  const usd = tokens * usdPerToken
  return `~$${usd.toFixed(2)}`
}
