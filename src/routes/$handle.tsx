import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { formatUnits } from 'viem'
import { resolveHandle } from '@/lib/resolve'
import { profile as profileApi, type TierDef } from '@/lib/api'
import { keyFromHex } from '@/lib/crypto'
import { readTokenMeta } from '@/lib/token'
import { formatDuration } from '@/lib/tiers'
import { PostCard } from '@/components/PostCard'
import { SubscribeButton } from '@/components/SubscribeButton'
import type { Address } from 'viem'
import styles from './$handle.module.css'

// `/$handle` — creator profile (public + subscriber view). The param is a handle or proxy: a
// 40-hex address is used directly, otherwise resolved on-chain (§6). No wallet needed to view —
// public posts carry their key in the profile and decrypt for anyone; paywalled posts show locked.
export const Route = createFileRoute('/$handle')({
  component: CreatorProfile,
})

function short(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function TierCard({ tier, creatorProxy }: { tier: TierDef; creatorProxy: Address }) {
  const { data: meta } = useQuery({
    queryKey: ['tokenMeta', tier.token],
    queryFn: () => readTokenMeta(tier.token),
  })
  return (
    <div className={styles.tierCard}>
      <span className={styles.tierCardId}>Tier {tier.tierId}</span>
      <span className={styles.tierCardPrice}>
        {meta ? `${formatUnits(BigInt(tier.price), meta.decimals)} ${meta.symbol}` : '…'}
      </span>
      <span className={styles.tierCardMeta}>every {formatDuration(BigInt(tier.duration))}</span>
      <SubscribeButton creatorProxy={creatorProxy} tier={tier} />
    </div>
  )
}

function CreatorProfile() {
  const { handle } = Route.useParams()

  const resolveQuery = useQuery({
    queryKey: ['resolve', handle],
    queryFn: () => resolveHandle(handle),
  })
  const proxy = resolveQuery.data ?? null

  const profileQuery = useQuery({
    queryKey: ['profile', proxy],
    queryFn: () => profileApi.get(proxy!),
    enabled: !!proxy,
  })

  if (resolveQuery.isPending) {
    return <p className={styles.muted}>Resolving…</p>
  }
  if (!proxy) {
    return (
      <section className={styles.root}>
        <h1 className={styles.name}>Not found</h1>
        <p className={styles.muted}>No DEN creator resolves to “{handle}”.</p>
      </section>
    )
  }
  if (profileQuery.isPending) {
    return <p className={styles.muted}>Loading profile…</p>
  }
  if (profileQuery.isError) {
    return (
      <section className={styles.root}>
        <h1 className={styles.name}>{short(proxy)}</h1>
        <p className={styles.muted}>This creator’s instance couldn’t be reached.</p>
      </section>
    )
  }

  const p = profileQuery.data
  const posts = [...p.publicContent].sort((a, b) => b.timestamp - a.timestamp)

  return (
    <section className={styles.root}>
      <header className={styles.head}>
        <h1 className={styles.name}>{p.handle || short(p.proxy)}</h1>
        <p className={styles.proxy}>{short(p.proxy)}</p>
        {p.bio && <p className={styles.bio}>{p.bio}</p>}
      </header>

      {p.tiers.length > 0 && (
        <div className={styles.tiers}>
          {p.tiers.map((t) => (
            <TierCard key={t.tierId} tier={t} creatorProxy={p.proxy} />
          ))}
        </div>
      )}

      <div className={styles.posts}>
        {posts.length === 0 ? (
          <p className={styles.muted}>No public posts yet.</p>
        ) : (
          posts.map((c) => (
            <PostCard
              key={c.fingerprint}
              fingerprint={c.fingerprint}
              keyBytes={keyFromHex(c.contentKey)}
              warnings={c.warnings}
              timestamp={c.timestamp}
            />
          ))
        )}
      </div>
    </section>
  )
}
