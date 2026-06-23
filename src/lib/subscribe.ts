/**
 * Subscription purchase — PROTOCOL.md "Subscriber flow", furden-architecture.md Flow 4.
 *
 * Subscribing is a pure on-chain interaction (no instance session): the subscriber's wallet must
 * hold a registered proxy (the same one-time register() as onboarding — reused from lib/onboarding),
 * then `subscribe(creatorProxy, tierId)` is called payable. ETH tiers pass the price as msg.value;
 * ERC-20 tiers pass 0 and require a prior approve() to the subscription contract.
 */
import type { Address } from 'viem'
import { readContract, writeContract, waitForTransactionReceipt } from 'wagmi/actions'
import { wagmiConfig } from './wagmi'
import { subscriptionAbi, erc20Abi } from './abis'
import { getContracts } from './chain'
import { env } from './env'
import { isEth } from './token'

function subscriptionAddress(): Address {
  return getContracts(env.chainId).subscription
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
