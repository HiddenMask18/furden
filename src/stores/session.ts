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
  // A live session hit a 401 (§5 step 4) — distinguishes "Your session ended" banner copy from
  // never-signed-in. Reset on the next successful sign-in and on wallet disconnect.
  sessionEnded: boolean
  // The challenge/verify sequence is in flight (wallet signature prompt may be open). The
  // sign-in banner stays hidden while this is true — a pending prompt is not an error state.
  authPending: boolean
  setSession: (token: string, proxy: Address, walletAddress: Address) => void
  setIsCreator: (v: boolean) => void
  setAuthPending: (v: boolean) => void
  clearSession: () => void
}

export const useSessionStore = create<SessionState>((set) => ({
  token: null,
  proxy: null,
  walletAddress: null,
  isCreator: false,
  sessionEnded: false,
  authPending: false,
  setSession: (token, proxy, walletAddress) =>
    set({ token, proxy, walletAddress, sessionEnded: false }),
  setIsCreator: (isCreator) => set({ isCreator }),
  setAuthPending: (authPending) => set({ authPending }),
  // Called on wallet disconnect and on any 401. Transitions UI to unauthenticated immediately.
  // sessionEnded flips only when a session actually existed (a 401 on verify for a wallet that
  // never signed in is not an ended session).
  clearSession: () =>
    set((s) => ({
      token: null,
      proxy: null,
      walletAddress: null,
      isCreator: false,
      sessionEnded: s.token != null,
    })),
}))
