/**
 * Session store — furden-architecture.md §4.
 * Auth token (memory only, never localStorage), proxy, wallet address, isCreator.
 */
import { create } from 'zustand'
import type { Address } from 'viem'

type SessionState = {
  token: string | null
  proxy: Address | null
  walletAddress: Address | null
  isCreator: boolean
  setSession: (token: string, proxy: Address, walletAddress: Address) => void
  setIsCreator: (v: boolean) => void
  clearSession: () => void
}

export const useSessionStore = create<SessionState>((set) => ({
  token: null,
  proxy: null,
  walletAddress: null,
  isCreator: false,
  setSession: (token, proxy, walletAddress) => set({ token, proxy, walletAddress }),
  setIsCreator: (isCreator) => set({ isCreator }),
  // Called on wallet disconnect and on any 401. Transitions UI to unauthenticated immediately.
  clearSession: () => set({ token: null, proxy: null, walletAddress: null, isCreator: false }),
}))
