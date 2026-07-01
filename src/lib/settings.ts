/**
 * Studio settings operations — handle, bio, and emergency wallet.
 *
 * Handle and emergency wallet are on-chain (identity registry / identity proxy); bio is instance-side
 * (PUT /creator/profile, in lib/api.ts). Chain ops go through wagmi/actions + wagmiConfig, the
 * lib/onboarding.ts pattern, so this module stays free of React hooks.
 *
 * The emergency wallet here is the ON-CHAIN designation only: it grants that wallet the power to
 * recover the identity via wallet rotation. Encrypting a recovery copy of the master secret to it
 * (the emergency portability blob) is a separate step that needs that wallet connected to sign — the
 * documented v1.x recovery-side follow-up (PROTOCOL.md step 5 note).
 */
import type { Address } from 'viem'
import { parseAbiItem, zeroAddress } from 'viem'
import {
  getPublicClient,
  readContract,
  writeContract,
  waitForTransactionReceipt,
} from 'wagmi/actions'
import { wagmiConfig } from './wagmi'
import { identityRegistryAbi, identityImplAbi, governanceAbi } from './abis'
import { getContracts, deployBlock } from './chain'
import { env } from './env'

const contracts = () => getContracts(env.chainId)

export type HandleChangeStatus = { allowance: number; remaining: number }

/**
 * How many handle changes remain in the current period. The registry tracks (changeCount,
 * periodStart) per proxy; the allowance and period length are governance parameters. A period that
 * has elapsed rolls the count back to zero, so a stale periodStart means the full allowance is free.
 */
export async function readHandleChangeStatus(proxy: Address): Promise<HandleChangeStatus> {
  const gov = contracts().governance
  const registry = contracts().identityRegistry
  const [allowance, period, info] = await Promise.all([
    readContract(wagmiConfig, { address: gov, abi: governanceAbi, functionName: 'getHandleChangeAllowance' }),
    readContract(wagmiConfig, { address: gov, abi: governanceAbi, functionName: 'getHandleChangePeriod' }),
    readContract(wagmiConfig, {
      address: registry,
      abi: identityRegistryAbi,
      functionName: 'handleChangeInfo',
      args: [proxy],
    }),
  ])
  const [changeCount, periodStart] = info
  const now = BigInt(Math.floor(Date.now() / 1000))
  const rolledOver = periodStart === 0n || now >= periodStart + period
  const used = rolledOver ? 0n : changeCount
  const remaining = allowance > used ? Number(allowance - used) : 0
  return { allowance: Number(allowance), remaining }
}

/** Set (or change) the on-chain handle. Called by the primary wallet; rate-limited by governance. */
export async function setHandle(newHandle: string): Promise<void> {
  const hash = await writeContract(wagmiConfig, {
    address: contracts().identityRegistry,
    abi: identityRegistryAbi,
    functionName: 'setHandle',
    args: [newHandle],
  })
  await waitForTransactionReceipt(wagmiConfig, { hash })
}

const EMERGENCY_REGISTERED = parseAbiItem('event EmergencyWalletRegistered(address indexed wallet)')

/**
 * The proxy's currently-registered emergency wallet, or null. Read from the latest
 * EmergencyWalletRegistered event on the proxy, then confirmed still active with isEmergencyWallet
 * (revocation removes it without a dedicated event we track here).
 */
export async function readEmergencyWallet(proxy: Address): Promise<Address | null> {
  const client = getPublicClient(wagmiConfig)
  if (!client) throw new Error('No RPC client available.')

  const logs = await client.getLogs({
    address: proxy,
    event: EMERGENCY_REGISTERED,
    fromBlock: deployBlock,
    toBlock: 'latest',
  })
  const latest = logs.at(-1)?.args.wallet
  if (!latest || latest === zeroAddress) return null

  const active = await readContract(wagmiConfig, {
    address: proxy,
    abi: identityImplAbi,
    functionName: 'isEmergencyWallet',
    args: [latest],
  })
  return active ? latest : null
}

/** Designate an emergency wallet on-chain (called at the proxy address by the primary wallet). */
export async function registerEmergencyWallet(proxy: Address, wallet: Address): Promise<void> {
  const hash = await writeContract(wagmiConfig, {
    address: proxy,
    abi: identityImplAbi,
    functionName: 'registerEmergencyWallet',
    args: [wallet],
  })
  await waitForTransactionReceipt(wagmiConfig, { hash })
}
