import { useAccount, useDisconnect } from 'wagmi'
import { Link } from '@tanstack/react-router'
import styles from './WalletBadge.module.css'

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

/**
 * Header wallet badge — shows the connected address (monospace) with a disconnect action, or a
 * link to /connect when no wallet is connected. The full connect modal (Radix Dialog over
 * wagmi useConnect) is built on the /connect route — this is just the header entry point.
 */
export function WalletBadge() {
  const { address, status } = useAccount()
  const { disconnect } = useDisconnect()

  if (status === 'connected' && address) {
    return (
      <span className={styles.root}>
        <span className={`${styles.addr} mono`}>{short(address)}</span>
        <button className={styles.action} onClick={() => disconnect()}>
          Disconnect
        </button>
      </span>
    )
  }

  return (
    <Link to="/connect" className={styles.connect}>
      Connect wallet
    </Link>
  )
}
