/**
 * Governance store — furden-architecture.md §4.
 * Fetched once at startup (GET /governance/params). Read-only after fetch. On failure the app
 * proceeds with conservative defaults (tier-0 limits, 2.5% fee) — startup must not block.
 */
import { create } from 'zustand'
import { governance as governanceApi } from '@/lib/api'

export type GovernanceParams = Record<string, unknown>

type GovernanceState = {
  params: GovernanceParams | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  fetch: () => Promise<void>
}

// Conservative fallback used when the params fetch fails (non-critical for auth/viewing).
export const DEFAULT_PARAMS: GovernanceParams = {
  fees: { protocol_fee_bps: '250' },
  trust_tiers: {
    post_size_limits: { tier_0: '10485760', tier_1: '10485760', tier_2: '10485760', tier_3: '10485760' },
  },
}

export const useGovernanceStore = create<GovernanceState>((set) => ({
  params: null,
  status: 'idle',
  fetch: async () => {
    set({ status: 'loading' })
    try {
      const params = await governanceApi.params()
      set({ params, status: 'ready' })
    } catch {
      set({ params: DEFAULT_PARAMS, status: 'error' })
    }
  },
}))
