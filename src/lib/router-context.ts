/**
 * Router context shape — furden-architecture.md §6.
 * Carries session state so routes can guard in `beforeLoad` without importing Zustand directly.
 */
import type { Address } from 'viem'

export type RouterContext = {
  session: {
    token: string | null
    proxy: Address | null
    walletAddress: Address | null
    isCreator: boolean
  }
}

export const emptySession: RouterContext['session'] = {
  token: null,
  proxy: null,
  walletAddress: null,
  isCreator: false,
}
