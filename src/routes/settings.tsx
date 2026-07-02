import { createFileRoute, redirect } from '@tanstack/react-router'
import { useAccount, useDisconnect } from 'wagmi'
import { activeChainId, chainKind } from '@/lib/chain'
import { env } from '@/lib/env'
import { useSessionStore } from '@/stores/session'
import styles from './settings.module.css'

// `/settings` — subscriber account settings (DESIGN.md IA: wallet, connected network, session).
// Read-only by design: identity lives in the wallet and on-chain, the session lives in memory —
// there are no server-side preferences to edit. The one action is disconnecting.
export const Route = createFileRoute('/settings')({
  beforeLoad: ({ context, location }) => {
    if (!context.session.token) {
      throw redirect({ to: '/connect', search: { from: location.href } })
    }
  },
  component: Settings,
})

function Settings() {
  const { address, connector } = useAccount()
  const { disconnect } = useDisconnect()
  const proxy = useSessionStore((s) => s.proxy)
  const isCreator = useSessionStore((s) => s.isCreator)

  const kind = chainKind(activeChainId)
  const chainLabel = kind === 'mainnet' ? 'Base' : kind === 'testnet' ? 'Base Sepolia' : 'Local dev'

  return (
    <section className={styles.root}>
      <h1 className={styles.title}>Settings</h1>
      <p className={styles.lead}>
        There is no account here to manage. Your identity is your wallet, your subscriptions live
        on-chain, and your session lives in this tab's memory — it ends when you refresh,
        disconnect, or after 24 hours. Nothing about you is stored in this browser.
      </p>

      <dl className={styles.rows}>
        <div className={styles.row}>
          <dt className={styles.label}>Wallet</dt>
          <dd className={styles.value}>
            <span className={styles.mono}>{address}</span>
            {connector && <span className={styles.sub}>via {connector.name}</span>}
          </dd>
        </div>
        <div className={styles.row}>
          <dt className={styles.label}>DEN identity</dt>
          <dd className={styles.value}>
            <span className={styles.mono}>{proxy}</span>
            <span className={styles.sub}>
              {isCreator ? 'Creator — manage your studio under Studio.' : 'Subscriber'}
            </span>
          </dd>
        </div>
        <div className={styles.row}>
          <dt className={styles.label}>Network</dt>
          <dd className={styles.value}>
            {chainLabel} <span className={styles.sub}>chain {activeChainId}</span>
          </dd>
        </div>
        <div className={styles.row}>
          <dt className={styles.label}>Instance</dt>
          <dd className={styles.value}>
            {env.instanceName} <span className={styles.sub}>{env.instanceUrl}</span>
          </dd>
        </div>
      </dl>

      <div className={styles.actions}>
        <button type="button" className={styles.danger} onClick={() => disconnect()}>
          Disconnect wallet
        </button>
        <p className={styles.hint}>
          Disconnecting ends your session and wipes every key held in memory.
        </p>
      </div>
    </section>
  )
}
