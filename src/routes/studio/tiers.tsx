import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { formatUnits, parseUnits, type Address } from 'viem'
import { useSessionStore } from '@/stores/session'
import { ETH_SENTINEL } from '@/lib/chain'
import { readTiers, setTier, formatDuration, type Tier } from '@/lib/tiers'
import { readTokenMeta } from '@/lib/token'
import { ApiError } from '@/lib/api'
import styles from './tiers.module.css'

// `/studio/tiers` — subscription tier management. DENSubscription.setTier(tierId, price, duration,
// token); tiers are read back from on-chain TierSet events (lib/tiers.ts). Real tiers number from
// 1 — tier 0 is reserved for public content. A tier created here is what subscribers pay for and
// what the composer's paywalled path encrypts against.
export const Route = createFileRoute('/studio/tiers')({
  component: Tiers,
})

function humanize(e: unknown): string {
  if (e instanceof ApiError) return e.message
  const msg = e instanceof Error ? e.message : String(e)
  if (/user rejected|rejected|denied|4001/i.test(msg)) return 'Cancelled in your wallet.'
  return msg
}

function TierRow({
  tier,
  onEdit,
}: {
  tier: Tier
  onEdit: (tier: Tier, priceText: string) => void
}) {
  const { data: meta } = useQuery({
    queryKey: ['tokenMeta', tier.token],
    queryFn: () => readTokenMeta(tier.token),
  })
  const priceText = meta ? formatUnits(tier.price, meta.decimals) : null

  return (
    <li className={styles.tier}>
      <div className={styles.tierMain}>
        <span className={styles.tierId}>Tier {tier.tierId}</span>
        <span className={styles.tierPrice}>
          {priceText != null ? `${priceText} ${meta!.symbol}` : '…'}
        </span>
        <span className={styles.tierMeta}>every {formatDuration(tier.duration)}</span>
      </div>
      <button
        type="button"
        className={styles.editButton}
        onClick={() => onEdit(tier, priceText ?? '')}
        disabled={priceText == null}
      >
        Edit
      </button>
    </li>
  )
}

function Tiers() {
  const proxy = useSessionStore((s) => s.proxy)
  const qc = useQueryClient()

  const tiersQuery = useQuery({
    queryKey: ['tiers', proxy],
    queryFn: () => readTiers(proxy!),
    enabled: !!proxy,
  })
  const tiers = tiersQuery.data ?? []
  const nextId = tiers.length ? Math.max(...tiers.map((t) => t.tierId)) + 1 : 1

  const [tierId, setTierId] = useState('')
  const [price, setPrice] = useState('')
  const [durationDays, setDurationDays] = useState('30')
  const [tokenAddr, setTokenAddr] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function resetForm() {
    setTierId('')
    setPrice('')
    setDurationDays('30')
    setTokenAddr('')
  }

  function onEdit(tier: Tier, priceText: string) {
    setTierId(String(tier.tierId))
    setPrice(priceText)
    setDurationDays(String(Number(tier.duration) / 86400))
    setTokenAddr(tier.token.toLowerCase() === ETH_SENTINEL ? '' : tier.token)
    setError(null)
  }

  const effectiveId = tierId.trim() === '' ? nextId : Number(tierId)
  const days = Number(durationDays)
  const valid =
    Number.isInteger(effectiveId) &&
    effectiveId >= 1 &&
    price.trim() !== '' &&
    Number(price) > 0 &&
    Number.isFinite(days) &&
    days > 0

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const token = (tokenAddr.trim() || ETH_SENTINEL) as Address
      // Need the token's decimals to turn the human price into base units.
      const { decimals } = await readTokenMeta(token)
      await setTier({
        tierId: effectiveId,
        price: parseUnits(price.trim(), decimals),
        duration: BigInt(Math.round(days * 86400)),
        token,
      })
      await qc.invalidateQueries({ queryKey: ['tiers', proxy] })
      resetForm()
    } catch (e) {
      setError(humanize(e))
    } finally {
      setBusy(false)
    }
  }

  const editing = tiers.some((t) => String(t.tierId) === tierId.trim())

  return (
    <section className={styles.root}>
      <h1 className={styles.title}>Tiers</h1>
      <p className={styles.lead}>
        Define what subscribers pay, in any supported token, and for how long. These are the tiers
        the composer encrypts paywalled posts against.
      </p>

      <div className={styles.list}>
        {tiersQuery.isLoading ? (
          <p className={styles.muted}>Reading your tiers from chain…</p>
        ) : tiersQuery.isError ? (
          <p className={styles.error}>Couldn’t read tiers: {humanize(tiersQuery.error)}</p>
        ) : tiers.length === 0 ? (
          <p className={styles.muted}>No tiers yet. Create your first below.</p>
        ) : (
          <ul className={styles.tiers}>
            {tiers.map((t) => (
              <TierRow key={t.tierId} tier={t} onEdit={onEdit} />
            ))}
          </ul>
        )}
      </div>

      <div className={styles.form}>
        <h2 className={styles.formTitle}>{editing ? `Update tier ${tierId}` : 'New tier'}</h2>

        <div className={styles.grid}>
          <label className={styles.field}>
            <span className={styles.label}>Tier ID</span>
            <input
              className={styles.input}
              type="number"
              min={1}
              placeholder={String(nextId)}
              value={tierId}
              onChange={(e) => setTierId(e.target.value)}
              disabled={busy}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Price</span>
            <input
              className={styles.input}
              type="text"
              inputMode="decimal"
              placeholder="5"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              disabled={busy}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Duration (days)</span>
            <input
              className={styles.input}
              type="number"
              min={1}
              value={durationDays}
              onChange={(e) => setDurationDays(e.target.value)}
              disabled={busy}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Token address</span>
            <input
              className={styles.input}
              type="text"
              placeholder="Leave blank for ETH"
              value={tokenAddr}
              onChange={(e) => setTokenAddr(e.target.value)}
              disabled={busy}
            />
          </label>
        </div>

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primary}
            onClick={submit}
            disabled={!valid || busy}
          >
            {busy ? 'Confirm in your wallet…' : editing ? 'Update tier' : 'Create tier'}
          </button>
          {(tierId || price || tokenAddr) && !busy && (
            <button type="button" className={styles.ghost} onClick={resetForm}>
              Clear
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
