import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { decryptPost } from '@/lib/decrypt'
import styles from './PostCard.module.css'

/**
 * One decrypted post (furden-architecture.md §8 decryption pipeline). Given the post's key it
 * downloads the ciphertext, decrypts, parses the envelope, and renders text + images with each
 * image sized from its declared w/h before decode (no layout shift). With no key it renders the
 * locked state; on any decrypt/parse failure it renders the error card. Warned content is covered
 * until the viewer chooses to reveal it.
 */
type PostCardProps = {
  fingerprint: string
  /** The AES key for this post, or null when the viewer doesn't hold it (locked). */
  keyBytes: Uint8Array | null
  warnings: string[] | null
  timestamp: number // Unix ms
  authed?: boolean
  baseUrl?: string
}

export function PostCard({
  fingerprint,
  keyBytes,
  warnings,
  timestamp,
  authed,
  baseUrl,
}: PostCardProps) {
  const locked = keyBytes == null
  const hasWarnings = !!warnings && warnings.length > 0
  const [revealed, setRevealed] = useState(false)
  const [urls, setUrls] = useState<string[]>([])

  const query = useQuery({
    queryKey: ['post', fingerprint, authed ?? false],
    queryFn: () => decryptPost(fingerprint, keyBytes!, { authed, baseUrl }),
    enabled: !locked,
    retry: false,
  })

  // Build object URLs for the decrypted images; revoke them when they change or on unmount.
  const images = query.data?.images
  useEffect(() => {
    if (!images) {
      setUrls([])
      return
    }
    // Copy each subarray view into a fresh ArrayBuffer-backed array (also satisfies BlobPart,
    // which TS 5.7 types over ArrayBuffer rather than the generic ArrayBufferLike).
    const made = images.map((img) =>
      URL.createObjectURL(new Blob([new Uint8Array(img.bytes)], { type: img.type })),
    )
    setUrls(made)
    return () => made.forEach((u) => URL.revokeObjectURL(u))
  }, [images])

  const when = new Date(timestamp).toLocaleString()

  return (
    <article className={styles.card}>
      <header className={styles.meta}>
        <time className={styles.time}>{when}</time>
        {hasWarnings && (
          <span className={styles.warnTag}>{warnings!.join(', ')}</span>
        )}
      </header>

      {locked ? (
        <div className={styles.locked}>
          <span className={styles.lockIcon} aria-hidden>
            🔒
          </span>
          <p>Subscribe to this tier to unlock.</p>
        </div>
      ) : query.isPending ? (
        <div className={styles.skeleton} />
      ) : query.isError ? (
        <div className={styles.errorCard}>Content could not be decrypted.</div>
      ) : (
        <div className={styles.bodyWrap}>
          <div className={hasWarnings && !revealed ? styles.covered : undefined}>
            {query.data.text && <p className={styles.text}>{query.data.text}</p>}
            {query.data.images.map((img, i) => (
              <img
                key={i}
                className={styles.image}
                src={urls[i]}
                alt=""
                style={{ aspectRatio: `${img.w} / ${img.h}` }}
              />
            ))}
          </div>
          {hasWarnings && !revealed && (
            <button type="button" className={styles.reveal} onClick={() => setRevealed(true)}>
              Sensitive content: {warnings!.join(', ')} — tap to view
            </button>
          )}
        </div>
      )}
    </article>
  )
}
