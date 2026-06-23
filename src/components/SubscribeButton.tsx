import { useState } from 'react'
import { useAccount } from 'wagmi'
import type { Address } from 'viem'
import type { TierDef } from '@/lib/api'
import { ConnectModal } from './ConnectModal'
import { SubscribeDialog } from './SubscribeDialog'
import styles from './SubscribeButton.module.css'

/**
 * Subscribe action for a tier card. Self-contained: if the wallet isn't connected it opens the
 * shared ConnectModal first, then hands off to SubscribeDialog once connected — never nesting the
 * two dialogs. Subscribing needs no instance session, only a connected (and registered) wallet.
 */
export function SubscribeButton({
  creatorProxy,
  tier,
}: {
  creatorProxy: Address
  tier: TierDef
}) {
  const { status } = useAccount()
  const [connectOpen, setConnectOpen] = useState(false)
  const [subscribeOpen, setSubscribeOpen] = useState(false)

  function onClick() {
    if (status === 'connected') setSubscribeOpen(true)
    else setConnectOpen(true)
  }

  return (
    <>
      <button type="button" className={styles.button} onClick={onClick}>
        Subscribe
      </button>
      <ConnectModal
        open={connectOpen}
        onOpenChange={setConnectOpen}
        onConnected={() => {
          setConnectOpen(false)
          setSubscribeOpen(true)
        }}
      />
      <SubscribeDialog
        open={subscribeOpen}
        onOpenChange={setSubscribeOpen}
        creatorProxy={creatorProxy}
        tier={tier}
      />
    </>
  )
}
