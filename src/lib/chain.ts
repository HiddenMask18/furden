/**
 * Chain & contract registry — furden-architecture.md §2 / §3.
 *
 * Contract addresses are protocol constants per chain, NOT env vars or instance-fetched
 * config (§2 "Contract address sourcing"). On Anvil (31337) they default to nothing and must
 * be supplied via VITE_DEV_* overrides, since each local deployment differs.
 */
import { base, baseSepolia } from 'viem/chains'
import type { Address, Chain } from 'viem'
import { defineChain } from 'viem'
import { env } from './env'

export type ContractAddresses = {
  identityRegistry: Address
  subscription: Address
  contentRegistry: Address
  accessGrant: Address
  governance: Address
  trustTier: Address
  reportRegistry: Address
}

export const anvil = defineChain({
  id: 31337,
  name: 'Anvil',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://127.0.0.1:8545'] } },
})

/** The ETH sentinel used by tier definitions: address(0) means native ETH, not an ERC-20. */
export const ETH_SENTINEL = '0x0000000000000000000000000000000000000000' as const

const ZERO = '0x0000000000000000000000000000000000000000' as Address

// Populated once canonical deployments exist. Until then getContracts() throws for
// Base/Sepolia so misconfiguration surfaces at startup, not at the first contract call.
const ADDRESSES: Record<number, ContractAddresses | null> = {
  8453: null, // Base mainnet — TODO: fill in on canonical deployment
  84532: null, // Base Sepolia — TODO: fill in on testnet deployment
}

// `getLogs` fromBlock — the contract deployment block per chain, never 0 (§9 range strategy).
export const DEPLOY_BLOCK: Record<number, bigint> = {
  8453: 0n, // TODO: set to the DENSubscription deployment block on Base
  84532: 0n, // TODO: set to the DENSubscription deployment block on Base Sepolia
  31337: 0n,
}

function devOverrides(): ContractAddresses {
  const get = (v: string | undefined, name: string): Address => {
    if (!v) throw new Error(`Anvil dev mode requires ${name} to be set in .env.`)
    return v as Address
  }
  return {
    identityRegistry: get(import.meta.env.VITE_DEV_IDENTITY_REGISTRY_ADDRESS, 'VITE_DEV_IDENTITY_REGISTRY_ADDRESS'),
    subscription: get(import.meta.env.VITE_DEV_SUBSCRIPTION_ADDRESS, 'VITE_DEV_SUBSCRIPTION_ADDRESS'),
    contentRegistry: get(import.meta.env.VITE_DEV_CONTENT_REGISTRY_ADDRESS, 'VITE_DEV_CONTENT_REGISTRY_ADDRESS'),
    accessGrant: get(import.meta.env.VITE_DEV_ACCESS_GRANT_ADDRESS, 'VITE_DEV_ACCESS_GRANT_ADDRESS'),
    governance: get(import.meta.env.VITE_DEV_GOVERNANCE_ADDRESS, 'VITE_DEV_GOVERNANCE_ADDRESS'),
    trustTier: get(import.meta.env.VITE_DEV_TRUST_TIER_ADDRESS, 'VITE_DEV_TRUST_TIER_ADDRESS'),
    reportRegistry: get(import.meta.env.VITE_DEV_REPORT_REGISTRY_ADDRESS, 'VITE_DEV_REPORT_REGISTRY_ADDRESS'),
  }
}

export function getContracts(chainId: number): ContractAddresses {
  if (chainId === 31337) return devOverrides()
  const set = ADDRESSES[chainId]
  if (!set) throw new Error('Contracts not yet deployed on this network.')
  return set
}

export function getChain(chainId: number): Chain {
  switch (chainId) {
    case 8453:
      return base
    case 84532:
      return baseSepolia
    case 31337:
      return anvil
    default:
      throw new Error(`Unsupported chain id ${chainId}`)
  }
}

export function getBlockExplorerUrl(chainId: number): string {
  if (env.blockExplorerOverride) return env.blockExplorerOverride
  switch (chainId) {
    case 8453:
      return 'https://basescan.org'
    case 84532:
      return 'https://sepolia.basescan.org'
    default:
      return 'https://localhost'
  }
}

export type ChainKind = 'mainnet' | 'testnet' | 'dev'
export function chainKind(chainId: number): ChainKind {
  if (chainId === 8453) return 'mainnet'
  if (chainId === 84532) return 'testnet'
  return 'dev'
}

/**
 * Chainlink USD price feeds (decentralized — den-spec §3.5). Keyed by token contract address
 * (lowercased), plus the ETH sentinel. A token absent from this map shows NO fiat figure —
 * there is deliberately NO fallback to a centralized price API (Appendix A, "Subscription
 * price display"). Aggregators expose latestRoundData() + decimals(); see lib/price.ts.
 *
 * TODO: fill in real Base aggregator addresses before enabling fiat display on mainnet.
 */
export const CHAINLINK_USD_FEEDS: Record<number, Record<string, Address>> = {
  8453: {
    // [ETH_SENTINEL.toLowerCase()]: '0x...ETH/USD',
    // '0x...usdc': '0x...USDC/USD',
  },
  84532: {},
  31337: {},
}

export const activeChainId = env.chainId
export const activeChain = getChain(env.chainId)
export const deployBlock = DEPLOY_BLOCK[env.chainId] ?? 0n
