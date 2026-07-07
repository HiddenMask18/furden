/**
 * Session lifecycle helper — furden-architecture.md §5.
 * The challenge/verify sequence, shared by page-load re-auth and manual connect.
 */
import { hashMessage, recoverAddress, type Address } from 'viem'
import { auth as authApi, creator as creatorApi, ApiError } from './api'
import { keyFromHex, pubKeyFromSignature } from './crypto'
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
  // Mark the sequence in flight so the not-signed-in banner stays down while the wallet prompt
  // is open (§5.4 — a pending prompt is initiation, not an error state).
  useSessionStore.getState().setAuthPending(true)
  try {
    return await runSignIn(walletAddress, signMessageAsync)
  } finally {
    useSessionStore.getState().setAuthPending(false)
  }
}

async function runSignIn(
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
  let isCreator = false
  try {
    const { exists } = await creatorApi.blobExists()
    isCreator = exists
    useSessionStore.getState().setIsCreator(exists)
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return false
    useSessionStore.getState().setIsCreator(false)
  }

  // Key recovery (§5 sign-in sequence): the master secret is memory-only, so any page load loses
  // it. A
  // creator signing in on a fresh session gets it back from the instance — which can already
  // compute it (it decrypts the operational blob on every subscriber key request), so this
  // reveals nothing new to anyone. Non-fatal: on failure the studio degrades to locked
  // previews exactly as before recovery existed.
  if (isCreator && !useCryptoStore.getState().masterSecret) {
    try {
      const { masterSecret } = await creatorApi.masterSecret()
      const bytes = keyFromHex(masterSecret)
      if (bytes.length === 32) {
        useCryptoStore.getState().setMasterSecret(bytes)
      }
    } catch {
      // degraded creator session — recovery can be retried by signing in again
    }
  }
  return true
}
