import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { resolveHandle } from '@/lib/resolve'
import { profile as profileApi } from '@/lib/api'
import { keyFromHex } from '@/lib/crypto'
import { PostCard } from '@/components/PostCard'
import styles from './$handle.module.css'

// `/$handle/post/$fingerprint` — post permalink. One post = one fingerprint = stable identity.
// Same access rules as the profile: a public post (key in the profile) renders for anyone; a
// paywalled post renders locked. "Copy link" emits den://$handle/post/$fingerprint (den-spec
// §6.4), never an instance URL.
export const Route = createFileRoute('/$handle/post/$fingerprint')({
  component: PostPermalink,
})

function short(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function PostPermalink() {
  const { handle, fingerprint } = Route.useParams()
  const [copied, setCopied] = useState(false)

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

  const p = profileQuery.data
  const entry = p?.publicContent.find((c) => c.fingerprint === fingerprint)
  const warned = p?.contentWarnings.find((c) => c.fingerprint === fingerprint)

  // den-spec §6.4: shareable links use the handle form, never an instance URL.
  const denLink = `den://${p?.handle ?? handle}/post/${fingerprint}`
  async function copy() {
    await navigator.clipboard.writeText(denLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <section className={styles.root}>
      <Link to="/$handle" params={{ handle }} className={styles.backLink}>
        ← {p?.handle ?? (proxy ? short(proxy) : handle)}
      </Link>

      {resolveQuery.isPending || profileQuery.isPending ? (
        <p className={styles.muted}>Loading…</p>
      ) : !proxy ? (
        <p className={styles.muted}>No DEN creator resolves to “{handle}”.</p>
      ) : entry ? (
        <PostCard
          fingerprint={entry.fingerprint}
          keyBytes={keyFromHex(entry.contentKey)}
          warnings={entry.warnings}
          timestamp={entry.timestamp}
        />
      ) : (
        // Not in public content: either paywalled (render locked) or unknown to this instance.
        <PostCard
          fingerprint={fingerprint}
          keyBytes={null}
          warnings={warned?.warnings ?? null}
          timestamp={Date.now()}
        />
      )}

      <div className={styles.copyRow}>
        <button type="button" className={styles.copyButton} onClick={copy}>
          {copied ? 'Copied' : 'Copy link'}
        </button>
        <span className={styles.denLink}>{denLink}</span>
      </div>
    </section>
  )
}
