/**
 * Subscription purchase — PROTOCOL.md "Subscriber flow", furden-architecture.md Flow 4.
 *
 * Subscribing is a pure on-chain interaction (no instance session): the subscriber's wallet must
 * hold a registered proxy (the same one-time register() as onboarding — reused from lib/onboarding),
 * then `subscribe(creatorProxy, tierId)` is called payable. ETH tiers pass the price as msg.value;
 * ERC-20 tiers pass 0 and require a prior approve() to the subscription contract.
 */
import { zeroAddress, type Address } from 'viem'
import { readContract, writeContract, waitForTransactionReceipt } from 'wagmi/actions'
import { wagmiConfig } from './wagmi'
import { subscriptionAbi, erc20Abi, identityRegistryAbi } from './abis'
import { getContracts } from './chain'
import { env } from './env'
import { isEth } from './token'

function subscriptionAddress(): Address {
  return getContracts(env.chainId).subscription
}

export type SubscriptionStatus = {
  active: boolean
  expiresAt: bigint // Unix seconds; 0n when never subscribed (or wallet unregistered)
}

/**
 * Live subscription status for (wallet, creator, tier) — the already-subscribed pre-check.
 * Subscriptions are keyed by the subscriber's proxy, so this resolves wallet → proxy first;
 * an unregistered wallet has no proxy and therefore no subscription. Repeat subscribe EXTENDS
 * the expiry on-chain (it never refunds), so callers use this to relabel the action, not block it.
 */
export async function readSubscriptionStatus(
  wallet: Address,
  creatorProxy: Address,
  tierId: number,
): Promise<SubscriptionStatus> {
  const proxy = await readContract(wagmiConfig, {
    address: getContracts(env.chainId).identityRegistry,
    abi: identityRegistryAbi,
    functionName: 'getProxy',
    args: [wallet],
  })
  if (proxy === zeroAddress) return { active: false, expiresAt: 0n }
  const expiresAt = await readContract(wagmiConfig, {
    address: subscriptionAddress(),
    abi: subscriptionAbi,
    functionName: 'getSubscriptionExpiry',
    args: [proxy, creatorProxy, BigInt(tierId)],
  })
  // Same active test as the feed (expiry vs now) so the two surfaces never disagree.
  return { active: expiresAt > BigInt(Math.floor(Date.now() / 1000)), expiresAt }
}

/** Current ERC-20 allowance from the wallet to the subscription contract (the spender). */
export async function readAllowance(token: Address, owner: Address): Promise<bigint> {
  return readContract(wagmiConfig, {
    address: token,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [owner, subscriptionAddress()],
  })
}

/** Approve the subscription contract to spend `amount` of an ERC-20 token. */
export async function approveToken(token: Address, amount: bigint): Promise<void> {
  const hash = await writeContract(wagmiConfig, {
    address: token,
    abi: erc20Abi,
    functionName: 'approve',
    args: [subscriptionAddress(), amount],
  })
  await waitForTransactionReceipt(wagmiConfig, { hash })
}

/** Subscribe to a creator's tier. ETH tiers send the price as value; ERC-20 tiers send 0. */
export async function subscribe(
  creatorProxy: Address,
  tierId: number,
  price: bigint,
  token: Address,
): Promise<void> {
  const hash = await writeContract(wagmiConfig, {
    address: subscriptionAddress(),
    abi: subscriptionAbi,
    functionName: 'subscribe',
    args: [creatorProxy, BigInt(tierId)],
    value: isEth(token) ? price : 0n,
  })
  await waitForTransactionReceipt(wagmiConfig, { hash })
}
