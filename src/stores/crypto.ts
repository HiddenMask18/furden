/**
 * Crypto store — furden-architecture.md §4.
 *
 * DEVTOOLS DISABLED, never logged, never serialized: the master secret must not appear in any
 * browser extension or inspector. Held in memory for the session only; cleared on disconnect,
 * on clearSession, and on beforeunload.
 *
 * Content key cache: tier keys keyed `${creatorProxy}:${tierId}`; public per-post keys keyed by
 * fingerprint (each public post carries its own random key by construction).
 */
import { create } from 'zustand'
import type { Address } from 'viem'

type CryptoState = {
  masterSecret: Uint8Array | null
  // The connected wallet's secp256k1 public key, recovered from the sign-in signature (L0
  // signature merge) so key provisioning needs no second prompt. Not secret — but session-scoped
  // like everything here, so it can never go stale across a wallet switch.
  walletPubKey: Uint8Array | null
  contentKeys: Map<string, Uint8Array>
  setMasterSecret: (secret: Uint8Array) => void
  clearMasterSecret: () => void
  setWalletPubKey: (pubKey: Uint8Array) => void
  cacheContentKey: (creatorProxy: Address, tierId: number, key: Uint8Array) => void
  cachePublicKey: (fingerprint: string, key: Uint8Array) => void
  getContentKey: (creatorProxy: Address, tierId: number) => Uint8Array | null
  getPublicKey: (fingerprint: string) => Uint8Array | null
  clearAll: () => void
}

const tierKey = (proxy: Address, tierId: number) => `${proxy}:${tierId}`

export const useCryptoStore = create<CryptoState>((set, get) => ({
  masterSecret: null,
  walletPubKey: null,
  contentKeys: new Map(),
  setMasterSecret: (masterSecret) => set({ masterSecret }),
  clearMasterSecret: () => set({ masterSecret: null }),
  setWalletPubKey: (walletPubKey) => set({ walletPubKey }),
  cacheContentKey: (proxy, tierId, key) => {
    const next = new Map(get().contentKeys)
    next.set(tierKey(proxy, tierId), key)
    set({ contentKeys: next })
  },
  cachePublicKey: (fingerprint, key) => {
    const next = new Map(get().contentKeys)
    next.set(fingerprint, key)
    set({ contentKeys: next })
  },
  getContentKey: (proxy, tierId) => get().contentKeys.get(tierKey(proxy, tierId)) ?? null,
  getPublicKey: (fingerprint) => get().contentKeys.get(fingerprint) ?? null,
  clearAll: () => set({ masterSecret: null, walletPubKey: null, contentKeys: new Map() }),
}))
