import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useSessionStore } from '@/stores/session'
import { readHandle } from '@/lib/resolve'
import { readInstanceUrl } from '@/lib/onboarding'
import { readTiers } from '@/lib/tiers'
import { enumerateCreatorSubscribers } from '@/lib/feed'
import { env } from '@/lib/env'
import { loadLibrary } from './content'
import styles from './index.module.css'

// `/studio` dashboard — a read-only overview assembled from the same on-chain + instance reads the
// rest of the studio uses (loadLibrary, readTiers, the Subscribed logs), so it shares their query
// caches. No new data source: the instance is not an index (§9), counts come from chain + listing.
export const Route = createFileRoute('/studio/')({
  component: Dashboard,
})

function short(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function Stat({ label, value, to }: { label: string; value: string; to?: string }) {
  const body = (
    <>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </>
  )
  return to ? (
    <Link to={to} className={styles.stat}>
      {body}
    </Link>
  ) : (
    <div className={styles.stat}>{body}</div>
  )
}

function Dashboard() {
  const proxy = useSessionStore((s) => s.proxy)

  const handleQuery = useQuery({
    queryKey: ['handle', proxy],
    queryFn: () => readHandle(proxy!),
    enabled: !!proxy,
  })
  const instanceQuery = useQuery({
    queryKey: ['instanceURL', proxy],
    queryFn: () => readInstanceUrl(proxy!),
    enabled: !!proxy,
  })
  const libQuery = useQuery({
    queryKey: ['library', proxy],
    queryFn: () => loadLibrary(proxy!),
    enabled: !!proxy,
  })
  const tiersQuery = useQuery({
    queryKey: ['tiers', proxy],
    queryFn: () => readTiers(proxy!),
    enabled: !!proxy,
  })
  const subsQuery = useQuery({
    queryKey: ['creatorSubscribers', proxy],
    queryFn: () => enumerateCreatorSubscribers(proxy!),
    enabled: !!proxy,
  })

  const items = libQuery.data ?? []
  const publicCount = items.filter((i) => i.isPublic).length
  const paywalledCount = items.length - publicCount

  const now = BigInt(Math.floor(Date.now() / 1000))
  const activeSubscribers = subsQuery.data
    ? new Set(subsQuery.data.filter((s) => s.expiresAt > now).map((s) => s.subscriberProxy)).size
    : null

  const handle = handleQuery.data || ''
  const instanceUrl = instanceQuery.data
  const published = !!instanceUrl && instanceUrl.length > 0
  const onConfigured = published && instanceUrl === env.instanceUrl

  const recent = items.slice(0, 5)

  const num = (v: number | null | undefined, pending: boolean) => (pending ? '—' : String(v ?? 0))

  return (
    <section className={styles.root}>
      <header className={styles.header}>
        <h1 className={styles.title}>{handle ? `@${handle}` : 'Your studio'}</h1>
        <p className={styles.proxy}>{proxy ? short(proxy) : ''}</p>
      </header>

      {instanceQuery.isSuccess && !published && (
        <p className={styles.warnBanner}>
          You haven&rsquo;t published your instance URL, so your posts won&rsquo;t appear in
          subscribers&rsquo; feeds. <Link to="/onboard" className={styles.bannerLink}>Finish setup</Link> to
          publish it.
        </p>
      )}
      {published && !onConfigured && (
        <p className={styles.warnBanner}>
          Your on-chain instance URL points to another site — subscribers here won&rsquo;t see your
          feed on this instance.
        </p>
      )}

      <div className={styles.stats}>
        <Stat label="Posts" value={num(items.length, libQuery.isPending)} to="/studio/content" />
        <Stat
          label="Active subscribers"
          value={num(activeSubscribers, subsQuery.isPending)}
        />
        <Stat label="Tiers" value={num(tiersQuery.data?.length, tiersQuery.isPending)} to="/studio/tiers" />
      </div>

      {!libQuery.isPending && items.length > 0 && (
        <p className={styles.split}>
          {publicCount} public · {paywalledCount} paywalled
        </p>
      )}

      <div className={styles.actions}>
        <Link to="/studio/post" className={styles.primaryAction}>
          New post
        </Link>
        <Link to="/studio/tiers" className={styles.secondaryAction}>
          Manage tiers
        </Link>
      </div>

      <section className={styles.recent}>
        <div className={styles.recentHead}>
          <h2 className={styles.recentTitle}>Recent posts</h2>
          {items.length > 0 && (
            <Link to="/studio/content" className={styles.viewAll}>
              View all →
            </Link>
          )}
        </div>

        {libQuery.isPending ? (
          <p className={styles.muted}>Loading…</p>
        ) : libQuery.isError ? (
          <p className={styles.muted}>Couldn&rsquo;t load your posts.</p>
        ) : recent.length === 0 ? (
          <p className={styles.muted}>
            Nothing yet. <Link to="/studio/post" className={styles.bannerLink}>Publish your first post.</Link>
          </p>
        ) : (
          <ul className={styles.list}>
            {recent.map((item) => (
              <li key={item.fingerprint} className={styles.row}>
                <span className={styles.badge} data-kind={item.isPublic ? 'public' : 'tier'}>
                  {item.isPublic ? 'Public' : `Tier ${item.tierId}`}
                </span>
                <code className={styles.fp}>{short(item.fingerprint)}</code>
                <time className={styles.time}>{new Date(item.timestamp).toLocaleDateString()}</time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  )
}
