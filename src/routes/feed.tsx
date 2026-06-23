import { createFileRoute, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useSessionStore } from '@/stores/session'
import { assembleFeed } from '@/lib/feed'
import { PostCard } from '@/components/PostCard'
import styles from './feed.module.css'

// `/feed` — subscriber guard. Assembled client-side from on-chain `Subscribed` logs (§9): one
// getLogs by subscriberProxy → creators, filter to the configured instance, fetch inventory +
// keys per (creator, tier), merge by timestamp DESC, decrypt progressively.
export const Route = createFileRoute('/feed')({
  beforeLoad: ({ context, location }) => {
    if (!context.session.token) {
      throw redirect({ to: '/connect', search: { from: location.href } })
    }
  },
  component: Feed,
})

function Feed() {
  const proxy = useSessionStore((s) => s.proxy)

  const feedQuery = useQuery({
    queryKey: ['feed', proxy],
    queryFn: () => assembleFeed(proxy!),
    enabled: !!proxy,
  })

  return (
    <section className={styles.root}>
      <h1 className={styles.title}>Your feed</h1>

      {feedQuery.isPending ? (
        <p className={styles.muted}>Reading your subscriptions from chain…</p>
      ) : feedQuery.isError ? (
        <p className={styles.muted}>Couldn’t assemble your feed. Try again in a moment.</p>
      ) : feedQuery.data.length === 0 ? (
        <div className={styles.empty}>
          <p>Nothing here yet.</p>
          <p className={styles.emptySub}>
            Posts from creators you subscribe to on this instance show up here, newest first. Visit a
            creator’s page to subscribe.
          </p>
        </div>
      ) : (
        <div className={styles.posts}>
          {feedQuery.data.map((item) => (
            <PostCard
              key={item.fingerprint}
              fingerprint={item.fingerprint}
              keyBytes={item.key}
              warnings={item.warnings}
              timestamp={item.timestamp}
              authed
            />
          ))}
        </div>
      )}
    </section>
  )
}
