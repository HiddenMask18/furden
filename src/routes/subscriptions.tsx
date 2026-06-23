import { createFileRoute, redirect, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useSessionStore } from '@/stores/session'
import { enumerateSubscriptions, type Subscription } from '@/lib/feed'
import { readHandle } from '@/lib/resolve'
import { readInstanceUrl } from '@/lib/onboarding'
import { env } from '@/lib/env'
import styles from './subscriptions.module.css'

// `/subscriptions` — subscriber guard. Enumerated from on-chain `Subscribed` logs; current expiry
// read live per subscription (§9). Creators hosted on another instance appear as honest link-outs
// ("Hosted on another DEN site → Open"), never a broken-subscription screen.
export const Route = createFileRoute('/subscriptions')({
  beforeLoad: ({ context, location }) => {
    if (!context.session.token) {
      throw redirect({ to: '/connect', search: { from: location.href } })
    }
  },
  component: Subscriptions,
})

function short(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

type Status = { label: string; kind: 'active' | 'soon' | 'expired' }
function statusOf(expiresAt: bigint): Status {
  const now = Math.floor(Date.now() / 1000)
  const exp = Number(expiresAt)
  if (exp <= now) return { label: 'Expired', kind: 'expired' }
  if (exp - now < 7 * 86400) return { label: 'Expiring soon', kind: 'soon' }
  return { label: 'Active', kind: 'active' }
}

function SubRow({ sub }: { sub: Subscription }) {
  const { creatorProxy } = sub
  const handleQuery = useQuery({
    queryKey: ['handle', creatorProxy],
    queryFn: () => readHandle(creatorProxy),
  })
  const instanceQuery = useQuery({
    queryKey: ['instanceURL', creatorProxy],
    queryFn: () => readInstanceUrl(creatorProxy),
  })

  const handle = handleQuery.data || ''
  const name = handle || short(creatorProxy)
  const url = instanceQuery.data
  const onInstance = url != null && url === env.instanceUrl
  const status = statusOf(sub.expiresAt)
  const when = new Date(Number(sub.expiresAt) * 1000).toLocaleDateString()

  return (
    <li className={styles.row}>
      <div className={styles.main}>
        <span className={styles.name}>{name}</span>
        <span className={styles.tier}>Tier {sub.tierId}</span>
        <span className={styles.date}>
          {status.kind === 'expired' ? 'Expired' : 'Renews'} {when}
        </span>
      </div>

      <div className={styles.right}>
        <span className={styles.badge} data-kind={status.kind}>
          {status.label}
        </span>
        {instanceQuery.isPending ? (
          <span className={styles.muted}>…</span>
        ) : onInstance ? (
          <Link
            to="/$handle"
            params={{ handle: handle || creatorProxy }}
            className={styles.action}
          >
            {status.kind === 'expired' ? 'Renew' : 'View'}
          </Link>
        ) : (
          <a className={styles.action} href={url} target="_blank" rel="noreferrer">
            Open ↗
          </a>
        )}
      </div>

      {!instanceQuery.isPending && !onInstance && (
        <p className={styles.offNote}>Hosted on another DEN site.</p>
      )}
    </li>
  )
}

function Subscriptions() {
  const proxy = useSessionStore((s) => s.proxy)

  const subsQuery = useQuery({
    queryKey: ['subscriptions', proxy],
    queryFn: () => enumerateSubscriptions(proxy!),
    enabled: !!proxy,
  })

  // Active first, then expiring soon, then expired; newest expiry first within each.
  const order: Record<Status['kind'], number> = { active: 0, soon: 1, expired: 2 }
  const subs = [...(subsQuery.data ?? [])].sort((a, b) => {
    const d = order[statusOf(a.expiresAt).kind] - order[statusOf(b.expiresAt).kind]
    return d !== 0 ? d : Number(b.expiresAt - a.expiresAt)
  })

  return (
    <section className={styles.root}>
      <h1 className={styles.title}>Subscriptions</h1>

      {subsQuery.isPending ? (
        <p className={styles.muted}>Reading your subscriptions from chain…</p>
      ) : subsQuery.isError ? (
        <p className={styles.muted}>Couldn’t read your subscriptions. Try again in a moment.</p>
      ) : subs.length === 0 ? (
        <div className={styles.empty}>
          <p>No subscriptions yet.</p>
          <p className={styles.emptySub}>
            When you subscribe to a creator, it shows up here with its renewal date read live from
            chain.
          </p>
        </div>
      ) : (
        <ul className={styles.list}>
          {subs.map((s) => (
            <SubRow key={`${s.creatorProxy}:${s.tierId}`} sub={s} />
          ))}
        </ul>
      )}
    </section>
  )
}
