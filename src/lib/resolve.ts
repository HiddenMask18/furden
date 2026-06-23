/**
 * Handle resolution — furden-architecture.md §6.
 *
 * The `$handle` route param is either a proxy address or a handle. A 40-hex address is used
 * directly; anything else is resolved on-chain via DENIdentityRegistry.resolve(handle) (which
 * honours the handle-alias retention window). A zero-address result is the not-found case. All
 * subsequent profile operations use the resolved proxy, never the handle.
 */
import type { Address } from 'viem'
import { zeroAddress } from 'viem'
import { readContract } from 'wagmi/actions'
import { wagmiConfig } from './wagmi'
import { identityRegistryAbi } from './abis'
import { getContracts } from './chain'
import { env } from './env'

const PROXY_RE = /^0x[0-9a-fA-F]{40}$/

export async function resolveHandle(handleOrProxy: string): Promise<Address | null> {
  if (PROXY_RE.test(handleOrProxy)) return handleOrProxy as Address
  const proxy = await readContract(wagmiConfig, {
    address: getContracts(env.chainId).identityRegistry,
    abi: identityRegistryAbi,
    functionName: 'resolve',
    args: [handleOrProxy],
  })
  return proxy && proxy !== zeroAddress ? proxy : null
}
