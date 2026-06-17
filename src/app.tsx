import { useEffect, useRef } from 'react'
import { WagmiProvider, useAccount, useSignMessage } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { wagmiConfig } from './lib/wagmi'
import { router } from './router'
import { signIn } from './lib/auth'
import { useSessionStore } from './stores/session'
import { useCryptoStore } from './stores/crypto'
import { usePipelineStore } from './stores/pipeline'
import { useGovernanceStore } from './stores/governance'

const queryClient = new QueryClient()

/**
 * Bridges wagmi connection state and the session store into router context, and runs the
 * lifecycle effects from §5: page-load re-auth, disconnect cleanup, and the beforeunload wipe.
 */
function SessionBridge() {
  const { address, status } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const session = useSessionStore()
  const attempted = useRef<string | null>(null)

  // Fetch governance params once at startup (non-blocking).
  useEffect(() => {
    void useGovernanceStore.getState().fetch()
  }, [])

  // beforeunload — wipe master secret + content key cache before teardown (best-effort).
  useEffect(() => {
    const onUnload = () => useCryptoStore.getState().clearAll()
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [])

  // Page load / connect: if a wallet is connected and we have no session, sign in once.
  useEffect(() => {
    if (status === 'connected' && address && !session.token && attempted.current !== address) {
      attempted.current = address
      void signIn(address, signMessageAsync).catch(() => {
        /* user rejected or instance error — stays unauthenticated, surfaced in UI */
      })
    }
  }, [status, address, session.token, signMessageAsync])

  // Disconnect: clear everything (§5 step 5).
  useEffect(() => {
    if (status === 'disconnected' && session.token) {
      useSessionStore.getState().clearSession()
      useCryptoStore.getState().clearAll()
      usePipelineStore.getState().clear()
      attempted.current = null
    }
  }, [status, session.token])

  return (
    <RouterProvider
      router={router}
      context={{
        session: {
          token: session.token,
          proxy: session.proxy,
          walletAddress: session.walletAddress,
          isCreator: session.isCreator,
        },
      }}
    />
  )
}

export function App() {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <SessionBridge />
      </QueryClientProvider>
    </WagmiProvider>
  )
}
