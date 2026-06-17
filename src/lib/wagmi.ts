/**
 * wagmi configuration — furden-architecture.md §3.
 *
 * Connectors in priority order: injected, Coinbase Wallet, then WalletConnect ONLY when a
 * project id is configured (graceful degradation — never show a broken connector). No
 * RainbowKit/Web3Modal: the connection UI is built on wagmi primitives + a Radix Dialog.
 */
import { createConfig, http } from 'wagmi'
import { injected, coinbaseWallet, walletConnect } from 'wagmi/connectors'
import { activeChain } from './chain'
import { env } from './env'

const connectors = [
  injected(),
  coinbaseWallet({ appName: 'furden' }),
  ...(env.walletConnectProjectId
    ? [walletConnect({ projectId: env.walletConnectProjectId })]
    : []),
]

export const wagmiConfig = createConfig({
  chains: [activeChain],
  connectors,
  transports: {
    [activeChain.id]: http(),
  },
})

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig
  }
}
