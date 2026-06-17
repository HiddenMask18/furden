import { activeChainId, chainKind } from '@/lib/chain'
import styles from './ChainIndicator.module.css'

/**
 * Chain indicator — §7. Testnet amber is intentionally distinct and slightly alarming: a user
 * who mistakes testnet for mainnet would use real funds. Mainnet uses the accent colour.
 */
export function ChainIndicator() {
  const kind = chainKind(activeChainId)
  const label = kind === 'mainnet' ? 'Base' : kind === 'testnet' ? 'Base Sepolia' : 'Local dev'
  return (
    <span className={styles.root} data-kind={kind} title={`Chain ${activeChainId}`}>
      <span className={styles.dot} />
      {label}
    </span>
  )
}
