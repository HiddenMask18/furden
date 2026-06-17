/**
 * Session lifecycle helper — furden-architecture.md §5.
 * The challenge/verify sequence, shared by page-load re-auth and manual connect.
 */
import type { Address } from 'viem'
import { auth as authApi, creator as creatorApi, ApiError } from './api'
import { useSessionStore } from '@/stores/session'

/**
 * Run the full sign-in: challenge → wallet signature → verify → set session → derive isCreator.
 * `signMessageAsync` comes from wagmi's useSignMessage. Returns true on success.
 */
export async function signIn(
  walletAddress: Address,
  signMessageAsync: (args: { message: string }) => Promise<`0x${string}`>,
): Promise<boolean> {
  const { nonce } = await authApi.challenge(walletAddress)
  const signature = await signMessageAsync({ message: nonce })
  const { sessionToken, proxy } = await authApi.verify(walletAddress, nonce, signature)

  useSessionStore.getState().setSession(sessionToken, proxy, walletAddress)

  // isCreator = operational blob exists on the configured instance (§4). Best-effort.
  try {
    const { exists } = await creatorApi.blobExists()
    useSessionStore.getState().setIsCreator(exists)
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return false
    useSessionStore.getState().setIsCreator(false)
  }
  return true
}
