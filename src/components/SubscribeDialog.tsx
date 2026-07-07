import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useAccount } from 'wagmi'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { formatUnits, type Address } from 'viem'
import type { TierDef } from '@/lib/api'
import { ApiError } from '@/lib/api'
import { isWalletRegistered, registerIdentity } from '@/lib/onboarding'
import { readTokenMeta, isEth } from '@/lib/token'
import { formatDuration } from '@/lib/tiers'
import { readAllowance, approveToken, subscribe, readSubscriptionStatus } from '@/lib/subscribe'
import styles from './SubscribeDialog.module.css'

/**
 * Subscribe to one tier (PROTOCOL.md "Subscriber flow"). Assumes a connected wallet — the caller
 * handles connect. Drives the on-chain steps in order: register the subscriber's identity (once),
 * approve the token for ERC-20 tiers, then subscribe(). Each step is its own wallet transaction;
 * the dialog advances as on-chain state updates.
 */
type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  creatorProxy: Address
  tier: TierDef
  onSubscribed?: () => void
}

function humanize(e: unknown): string {
  if (e instanceof ApiError) return e.message
  const msg = e instanceof Error ? e.message : String(e)
  if (/user rejected|rejected|denied|4001/i.test(msg)) return 'Cancelled in your wallet.'
  return msg
}

export function SubscribeDialog({ open, onOpenChange, creatorProxy, tier, onSubscribed }: Props) {
  const { address } = useAccount()
  const qc = useQueryClient()
  const token = tier.token
  const price = BigInt(tier.price)
  const erc20 = !isEth(token)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Snapshot which action completed — after success the subscription query refetches as active,
  // so deriving the done copy from `extending` would mislabel a first subscribe as an extension.
  const [done, setDone] = useState<null | 'subscribed' | 'extended'>(null)

  // The dialog stays mounted between opens (the trigger owns `open`), so a finished run's
  // done/error state would otherwise greet the next open and make Extend unreachable.
  useEffect(() => {
    if (open) {
      setDone(null)
      setError(null)
    }
  }, [open])

  const metaQuery = useQuery({
    queryKey: ['tokenMeta', token],
    queryFn: () => readTokenMeta(token),
  })
  const registeredQuery = useQuery({
    queryKey: ['isRegistered', address],
    queryFn: () => isWalletRegistered(address!),
    enabled: !!address,
  })
  const allowanceQuery = useQuery({
    queryKey: ['allowance', token, address],
    queryFn: () => readAllowance(token, address!),
    enabled: !!address && erc20,
  })
  // Shared with SubscribeButton's pre-check (same key) — an active holder is EXTENDING, and the
  // copy must say so: paying again is valid (expiry extends) but must never look accidental.
  const subQuery = useQuery({
    queryKey: ['subscription', creatorProxy, tier.tierId, address],
    queryFn: () => readSubscriptionStatus(address!, creatorProxy, Number(tier.tierId)),
    enabled: !!address,
  })
  const extending = subQuery.data?.active ?? false
  const until = extending
    ? new Date(Number(subQuery.data!.expiresAt) * 1000).toLocaleDateString()
    : null

  const meta = metaQuery.data
  const priceText = meta ? `${formatUnits(price, meta.decimals)} ${meta.symbol}` : '…'

  const checking =
    registeredQuery.isPending ||
    metaQuery.isPending ||
    subQuery.isPending ||
    (erc20 && allowanceQuery.isPending)
  const needsApprove = erc20 && (allowanceQuery.data ?? 0n) < price

  const step: 'register' | 'approve' | 'subscribe' =
    registeredQuery.data === false ? 'register' : needsApprove ? 'approve' : 'subscribe'

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(humanize(e))
    } finally {
      setBusy(false)
    }
  }

  const onPrimary = () =>
    run(async () => {
      if (step === 'register') {
        await registerIdentity()
        await qc.invalidateQueries({ queryKey: ['isRegistered', address] })
      } else if (step === 'approve') {
        await approveToken(token, price)
        await qc.invalidateQueries({ queryKey: ['allowance', token, address] })
      } else {
        await subscribe(creatorProxy, Number(tier.tierId), price, token)
        setDone(extending ? 'extended' : 'subscribed')
        await qc.invalidateQueries({ queryKey: ['subscription', creatorProxy, tier.tierId, address] })
        onSubscribed?.()
      }
    })

  const primaryLabel = busy
    ? 'Confirm in your wallet…'
    : step === 'register'
      ? 'Register your identity'
      : step === 'approve'
        ? `Approve ${meta?.symbol ?? 'token'}`
        : `${extending ? 'Extend' : 'Subscribe'} — ${priceText}`

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.content}>
          <Dialog.Title className={styles.title}>
            {done
              ? done === 'extended'
                ? 'Extended'
                : 'Subscribed'
              : `${extending ? 'Extend' : 'Subscribe to'} tier ${tier.tierId}`}
          </Dialog.Title>

          <Dialog.Description className={styles.summary}>
            {priceText} · every {formatDuration(BigInt(tier.duration))}
          </Dialog.Description>

          {!done && extending && (
            <p className={styles.doneBody}>
              You already hold this tier until {until}. Paying again adds{' '}
              {formatDuration(BigInt(tier.duration))} on top — you won’t lose time.
            </p>
          )}

          {done ? (
            <>
              <p className={styles.doneBody}>
                {done === 'extended'
                  ? 'Your subscription now runs longer. Nothing else changes.'
                  : 'You now hold this tier. Its content unlocks in your feed.'}
              </p>
              <button
                type="button"
                className={styles.primary}
                onClick={() => onOpenChange(false)}
              >
                Done
              </button>
            </>
          ) : (
            <>
              {erc20 && (
                <ol className={styles.steps}>
                  <li data-active={step === 'register'}>Register</li>
                  <li data-active={step === 'approve'}>Approve {meta?.symbol ?? 'token'}</li>
                  <li data-active={step === 'subscribe'}>Subscribe</li>
                </ol>
              )}

              <button
                type="button"
                className={styles.primary}
                onClick={onPrimary}
                disabled={busy || checking}
              >
                {checking ? 'Checking…' : primaryLabel}
              </button>

              {error && (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              )}
            </>
          )}

          <Dialog.Close className={styles.close} aria-label="Close">
            ×
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
