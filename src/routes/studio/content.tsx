import { useMemo, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { Address } from 'viem'
import { creator as creatorApi, profile } from '@/lib/api'
import { deriveKey, tierPath, keyFromHex } from '@/lib/crypto'
import { useSessionStore } from '@/stores/session'
import { useCryptoStore } from '@/stores/crypto'
import { PostCard } from '@/components/PostCard'
import { VisibilityDialog } from '@/components/VisibilityDialog'
import styles from './content.module.css'

// `/studio/content` — content library. Visibility toggles are re-encryption events (§8): going
// public→private does not un-publish what was already public; copy must say so honestly.
export const Route = createFileRoute('/studio/content')({
  component: ContentLibrary,
})

/** One row of a creator's inventory, with the visibility state cross-referenced from the profile. */
export type LibraryItem = {
  fingerprint: string
  tierId: number
  timestamp: number // Unix ms
  warnings: string[] | null
  isPublic: boolean
  /** The published per-post key (hex), present only for public posts. */
  publicKeyHex?: string
}

/** Merge the creator's full inventory with the public subset (which alone carries keys + visibility). */
async function loadLibrary(proxy: Address): Promise<LibraryItem[]> {
  const [list, prof] = await Promise.all([creatorApi.listContent(), profile.get(proxy)])
  const publicKeys = new Map(prof.publicContent.map((p) => [p.fingerprint, p.contentKey]))
  return list.map((c) => ({
    fingerprint: c.fingerprint,
    tierId: Number(c.tierId),
    timestamp: c.timestamp,
    warnings: c.warnings,
    isPublic: publicKeys.has(c.fingerprint),
    publicKeyHex: publicKeys.get(c.fingerprint),
  }))
}

function LibraryRow({
  item,
  proxy,
  masterSecret,
  onManage,
}: {
  item: LibraryItem
  proxy: Address
  masterSecret: Uint8Array | null
  onManage: (item: LibraryItem) => void
}) {
  // The key needed to preview this post: the published key for public posts, or the tier-derived
  // key for paywalled ones (only available while the master secret is in memory — the v1 session gap).
  const keyBytes = useMemo(() => {
    if (item.isPublic) return item.publicKeyHex ? keyFromHex(item.publicKeyHex) : null
    return masterSecret ? deriveKey(masterSecret, tierPath(item.tierId)) : null
  }, [item.isPublic, item.publicKeyHex, item.tierId, masterSecret])

  const canManage = masterSecret != null

  return (
    <li className={styles.row}>
      <div className={styles.rowHead}>
        <span className={styles.badge} data-kind={item.isPublic ? 'public' : 'tier'}>
          {item.isPublic ? 'Public' : `Tier ${item.tierId}`}
        </span>
        <time className={styles.time}>{new Date(item.timestamp).toLocaleString()}</time>
        {item.warnings && item.warnings.length > 0 && (
          <span className={styles.warn}>{item.warnings.join(', ')}</span>
        )}
        <span className={styles.spacer} />
        {item.isPublic && (
          <Link
            to="/$handle/post/$fingerprint"
            params={{ handle: proxy, fingerprint: item.fingerprint }}
            className={styles.link}
          >
            Permalink
          </Link>
        )}
        <button
          type="button"
          className={styles.manage}
          onClick={() => onManage(item)}
          disabled={!canManage}
          title={canManage ? undefined : 'Reconnect after onboarding this session to change visibility.'}
        >
          {item.isPublic ? 'Make paywalled' : 'Make public'}
        </button>
      </div>

      <PostCard
        fingerprint={item.fingerprint}
        keyBytes={keyBytes}
        warnings={item.warnings}
        timestamp={item.timestamp}
        authed={!item.isPublic}
        showMeta={false}
        lockedMessage={
          item.isPublic
            ? 'This post is public but its key could not be loaded.'
            : "Your master key isn't in this session — reconnect after onboarding to preview it."
        }
      />
    </li>
  )
}

function ContentLibrary() {
  const proxy = useSessionStore((s) => s.proxy)
  const masterSecret = useCryptoStore((s) => s.masterSecret)
  const [managing, setManaging] = useState<LibraryItem | null>(null)

  const libQuery = useQuery({
    queryKey: ['library', proxy],
    queryFn: () => loadLibrary(proxy!),
    enabled: !!proxy,
  })

  const items = libQuery.data ?? []

  return (
    <section className={styles.root}>
      <header className={styles.header}>
        <h1 className={styles.title}>Content library</h1>
        <p className={styles.intro}>
          Everything you&rsquo;ve published, newest first. Changing a post&rsquo;s visibility
          re-encrypts it under a new key and registers a new copy on-chain — it is not a metadata
          flip. Returning a post to paywalled never un-publishes what was already public.
        </p>
        {!masterSecret && (
          <p className={styles.sessionNote}>
            Your master key isn&rsquo;t in this session, so visibility changes and paywalled previews
            are unavailable. Onboard again in this session to restore it (there is no in-browser
            recovery in v1).
          </p>
        )}
      </header>

      {libQuery.isPending ? (
        <p className={styles.muted}>Loading your library…</p>
      ) : libQuery.isError ? (
        <p className={styles.muted}>Couldn&rsquo;t load your library. Try again in a moment.</p>
      ) : items.length === 0 ? (
        <div className={styles.empty}>
          <p>Nothing published yet.</p>
          <p className={styles.emptySub}>
            Head to <Link to="/studio/post" className={styles.link}>New post</Link> to publish your
            first post.
          </p>
        </div>
      ) : (
        <ul className={styles.list}>
          {items.map((item) => (
            <LibraryRow
              key={item.fingerprint}
              item={item}
              proxy={proxy!}
              masterSecret={masterSecret}
              onManage={setManaging}
            />
          ))}
        </ul>
      )}

      {managing && proxy && masterSecret && (
        <VisibilityDialog
          open
          onOpenChange={(o) => !o && setManaging(null)}
          creatorProxy={proxy}
          masterSecret={masterSecret}
          item={managing}
        />
      )}
    </section>
  )
}
