import { useState } from 'react'
import { useAccount } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import type { Address } from 'viem'
import type { TierDef } from '@/lib/api'
import { readSubscriptionStatus } from '@/lib/subscribe'
import { ConnectModal } from './ConnectModal'
import { SubscribeDialog } from './SubscribeDialog'
import styles from './SubscribeButton.module.css'

/**
 * Subscribe action for a tier card. Self-contained: if the wallet isn't connected it opens the
 * shared ConnectModal first, then hands off to SubscribeDialog once connected — never nesting the
 * two dialogs. Subscribing needs no instance session, only a connected (and registered) wallet.
 *
 * Pre-checks the live subscription so an active holder sees their expiry and an "Extend" action
 * instead of a second "Subscribe" that reads like a bug when it charges again (it extends).
 */
export function SubscribeButton({
  creatorProxy,
  tier,
}: {
  creatorProxy: Address
  tier: TierDef
}) {
  const { status, address } = useAccount()
  const [connectOpen, setConnectOpen] = useState(false)
  const [subscribeOpen, setSubscribeOpen] = useState(false)

  const subQuery = useQuery({
    queryKey: ['subscription', creatorProxy, tier.tierId, address],
    queryFn: () => readSubscriptionStatus(address!, creatorProxy, Number(tier.tierId)),
    enabled: status === 'connected' && !!address,
  })
  const active = subQuery.data?.active ?? false

  function onClick() {
    if (status === 'connected') setSubscribeOpen(true)
    else setConnectOpen(true)
  }

  return (
    <>
      {active && (
        <p className={styles.status}>
          Subscribed · until{' '}
          {new Date(Number(subQuery.data!.expiresAt) * 1000).toLocaleDateString()}
        </p>
      )}
      <button type="button" className={styles.button} onClick={onClick}>
        {active ? 'Extend' : 'Subscribe'}
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
