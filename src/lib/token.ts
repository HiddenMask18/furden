/**
 * Token metadata — furden-architecture.md §3 ("Token metadata and price display").
 *
 * Symbol and decimals are read on-chain via ERC-20 `symbol()`/`decimals()` (no allowlist); the
 * ETH sentinel `address(0)` is native ETH. Components cache the result per token with TanStack
 * Query. The native amount is always the source of truth — the optional "~$" helper lives in
 * lib/price.ts.
 */
import type { Address } from 'viem'
import { readContract } from 'wagmi/actions'
import { wagmiConfig } from './wagmi'
import { erc20Abi } from './abis'
import { ETH_SENTINEL } from './chain'

export type TokenMeta = { symbol: string; decimals: number }

export function isEth(token: Address): boolean {
  return token.toLowerCase() === ETH_SENTINEL
}

export async function readTokenMeta(token: Address): Promise<TokenMeta> {
  if (isEth(token)) return { symbol: 'ETH', decimals: 18 }
  const [symbol, decimals] = await Promise.all([
    readContract(wagmiConfig, { address: token, abi: erc20Abi, functionName: 'symbol' }),
    readContract(wagmiConfig, { address: token, abi: erc20Abi, functionName: 'decimals' }),
  ])
  return { symbol, decimals }
}
