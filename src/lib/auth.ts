/**
 * Session lifecycle helper — furden-architecture.md §5.
 * The challenge/verify sequence, shared by page-load re-auth and manual connect.
 */
import { hashMessage, recoverAddress, type Address } from 'viem'
import { auth as authApi, creator as creatorApi, ApiError } from './api'
import { pubKeyFromSignature } from './crypto'
import { useSessionStore } from '@/stores/session'
import { useCryptoStore } from '@/stores/crypto'

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

  // L0 signature merge: this signature already reveals the wallet's public key, so recover and
  // keep it — key provisioning (the portability blob) then needs no second signature prompt.
  // The address check guards against a non-recoverable scheme (e.g. a smart-contract wallet):
  // encrypting the recovery blob to a mis-recovered key would be silent data loss, so on any
  // doubt we store nothing and provisioning falls back to its own dedicated prompt.
  try {
    const recovered = await recoverAddress({ hash: hashMessage(nonce), signature })
    if (recovered.toLowerCase() === walletAddress.toLowerCase()) {
      useCryptoStore.getState().setWalletPubKey(await pubKeyFromSignature(nonce, signature))
    }
  } catch {
    // non-fatal — fallback prompt at provisioning time
  }

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
