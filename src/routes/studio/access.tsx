import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSignMessage } from 'wagmi'
import type { Address } from 'viem'
import { ApiError } from '@/lib/api'
import { readTiers } from '@/lib/tiers'
import { readGrantState, type GrantState, type GrantStatus } from '@/lib/access'
import { ensureAccessGrant } from '@/lib/posting'
import { tierPath } from '@/lib/crypto'
import { useSessionStore } from '@/stores/session'
import styles from './access.module.css'

// `/studio/access` — access grant declarations. Each grant is signed by the creator's wallet
// (PROTOCOL.md "Access grant signing") and stored both on the instance and on-chain. This view
// reads both back per tier and shows how completely each is published; a partial state (one store
// only, e.g. after an interrupted post) can be repaired here with a fresh signature.
export const Route = createFileRoute('/studio/access')({
  component: AccessGrants,
})

const STATUS_LABEL: Record<GrantStatus, string> = {
  published: 'Published',
  'chain-only': 'On-chain only',
  'instance-only': 'Instance only',
  none: 'Not published',
}

function humanize(e: unknown): string {
  if (e instanceof ApiError) return e.message
  const msg = e instanceof Error ? e.message : String(e)
  if (/user rejected|rejected|denied|4001/i.test(msg)) return 'Cancelled in your wallet.'
  return msg
}

function GrantRow({ proxy, tierId }: { proxy: Address; tierId: number }) {
  const qc = useQueryClient()
  const { signMessageAsync } = useSignMessage()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const grantQuery = useQuery({
    queryKey: ['grant', proxy, tierId],
    queryFn: () => readGrantState(proxy, tierId),
  })
  const grant: GrantState | undefined = grantQuery.data

  async function publish() {
    setBusy(true)
    setError(null)
    try {
      await ensureAccessGrant(proxy, tierId, signMessageAsync)
      await qc.invalidateQueries({ queryKey: ['grant', proxy, tierId] })
    } catch (e) {
      setError(humanize(e))
    } finally {
      setBusy(false)
    }
  }

  const needsPublish = grant && grant.status !== 'published'
  const isPartial = grant?.status === 'chain-only' || grant?.status === 'instance-only'

  return (
    <li className={styles.row}>
      <div className={styles.rowHead}>
        <span className={styles.tierName}>Tier {tierId}</span>
        {grantQuery.isPending ? (
          <span className={styles.muted}>reading…</span>
        ) : grantQuery.isError ? (
          <span className={styles.muted}>read failed</span>
        ) : (
          <span className={styles.badge} data-status={grant!.status}>
            {STATUS_LABEL[grant!.status]}
          </span>
        )}
      </div>

      {grant && grant.status !== 'none' && (
        <dl className={styles.detail}>
          <div>
            <dt>Paths</dt>
            <dd>
              <code>
                {(grant.onChain.exists ? grant.onChain.paths : grant.instance?.paths ?? [tierPath(tierId)]).join(
                  ', ',
                )}
              </code>
            </dd>
          </div>
          <div>
            <dt>On-chain</dt>
            <dd>{grant.onChain.exists ? `v${grant.onChain.version}` : '—'}</dd>
          </div>
          <div>
            <dt>Instance</dt>
            <dd>{grant.instance ? `v${grant.instance.version}` : '—'}</dd>
          </div>
        </dl>
      )}

      {isPartial && (
        <p className={styles.warn}>
          This grant exists in only one store — subscribers may not be able to unlock this tier.
          Re-publish to bring both in sync.
        </p>
      )}

      {needsPublish && (
        <button type="button" className={styles.action} onClick={publish} disabled={busy}>
          {busy ? 'Confirm in your wallet…' : isPartial ? 'Repair grant' : 'Publish grant'}
        </button>
      )}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </li>
  )
}

function AccessGrants() {
  const proxy = useSessionStore((s) => s.proxy)

  const tiersQuery = useQuery({
    queryKey: ['tiers', proxy],
    queryFn: () => readTiers(proxy!),
    enabled: !!proxy,
  })
  const tiers = tiersQuery.data ?? []

  return (
    <section className={styles.root}>
      <header className={styles.header}>
        <h1 className={styles.title}>Access grants</h1>
        <p className={styles.intro}>
          Each tier authorises a content derivation path (<code>tier:N</code>). A grant is signed by
          your wallet and stored both on-chain and on this instance; the composer publishes it the
          first time you post to a tier. A tier stuck in only one store can be repaired here.
        </p>
      </header>

      {tiersQuery.isPending ? (
        <p className={styles.muted}>Loading tiers…</p>
      ) : tiersQuery.isError ? (
        <p className={styles.muted}>Couldn&rsquo;t load your tiers.</p>
      ) : tiers.length === 0 ? (
        <div className={styles.empty}>
          <p>No tiers yet.</p>
          <p className={styles.emptySub}>
            Create a tier in <Link to="/studio/tiers" className={styles.link}>Tiers</Link> — grants
            follow from there.
          </p>
        </div>
      ) : (
        <ul className={styles.list}>
          {tiers.map((t) => (
            <GrantRow key={t.tierId} proxy={proxy!} tierId={t.tierId} />
          ))}
        </ul>
      )}
    </section>
  )
}
