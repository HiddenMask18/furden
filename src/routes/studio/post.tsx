import { useEffect, useRef, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useGovernanceStore } from '@/stores/governance'
import { usePipelineStore } from '@/stores/pipeline'
import { useCryptoStore } from '@/stores/crypto'
import { useSessionStore } from '@/stores/session'
import { MAX_IMAGES, type EnvelopeImage } from '@/lib/envelope'
import { ApiError } from '@/lib/api'
import {
  PUBLIC_TIER_ID,
  postSizeLimit,
  buildPublicCiphertext,
  uploadPost,
  registerContentOnChain,
  markPublic,
} from '@/lib/posting'
import styles from './post.module.css'

// `/studio/post` — composer. buildEnvelope(text, images) → encrypt → upload → register → publish
// (§8, PROTOCOL.md "Content posting"). This is the PUBLIC path: a fresh random per-post key, no
// tier and no access grant, so it needs no master secret and works on a fresh page load. Paywalled
// posting (tier-derived key + grant) arrives with tier management.
export const Route = createFileRoute('/studio/post')({
  component: NewPost,
})

type Draft = { id: string; img: EnvelopeImage; url: string; name: string }

async function fileToDraft(file: File): Promise<Draft> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const url = URL.createObjectURL(file)
  // Capture pixel dimensions now so the feed can size each image before decode (no layout shift).
  const bitmap = await createImageBitmap(file)
  const draft: Draft = {
    id: crypto.randomUUID(),
    img: { bytes, type: file.type, w: bitmap.width, h: bitmap.height },
    url,
    name: file.name,
  }
  bitmap.close()
  return draft
}

function parseWarnings(input: string): string[] {
  return input
    .split(',')
    .map((w) => w.trim())
    .filter(Boolean)
}

function humanize(e: unknown): string {
  if (e instanceof ApiError) return e.message
  const msg = e instanceof Error ? e.message : String(e)
  if (/user rejected|rejected|denied|4001/i.test(msg)) return 'Cancelled in your wallet.'
  return msg
}

const PHASE_LABEL: Record<string, string> = {
  encrypting: 'Encrypting in your browser…',
  uploading: 'Uploading ciphertext…',
  registering: 'Registering on-chain — confirm in your wallet…',
}

function NewPost() {
  const proxy = useSessionStore((s) => s.proxy)
  const params = useGovernanceStore((s) => s.params)
  const maxBytes = postSizeLimit(params)

  const phase = usePipelineStore((s) => s.phase)
  const pipelineError = usePipelineStore((s) => s.error)
  const fingerprint = usePipelineStore((s) => s.fingerprint)

  const [text, setText] = useState('')
  const [images, setImages] = useState<Draft[]>([])
  const [warnings, setWarnings] = useState('')

  // Revoke preview object URLs on unmount (the canonical bytes live in the drafts, not the URLs).
  const imagesRef = useRef(images)
  imagesRef.current = images
  useEffect(() => () => imagesRef.current.forEach((d) => URL.revokeObjectURL(d.url)), [])

  const inFlight = phase === 'encrypting' || phase === 'uploading' || phase === 'registering'
  const empty = text.trim() === '' && images.length === 0

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith('image/'))
    e.target.value = '' // let the same file be re-picked after a removal
    const room = MAX_IMAGES - images.length
    if (room <= 0) return
    const drafts = await Promise.all(picked.slice(0, room).map(fileToDraft))
    setImages((prev) => [...prev, ...drafts])
  }

  function removeImage(id: string) {
    setImages((prev) => {
      const d = prev.find((x) => x.id === id)
      if (d) URL.revokeObjectURL(d.url)
      return prev.filter((x) => x.id !== id)
    })
  }

  // The three-phase pipeline (§8). Resumable: each phase is skipped when the store already holds
  // its output, so a Retry after a mid-pipeline failure picks up where it left off — never
  // re-encrypting or re-uploading work that already succeeded.
  async function runPipeline() {
    const store = usePipelineStore
    usePipelineStore.setState({ error: null })
    try {
      if (!store.getState().encryptedBlob || !store.getState().contentKey) {
        store.getState().startEncryption(PUBLIC_TIER_ID)
        const { ciphertext, key } = await buildPublicCiphertext(
          text,
          images.map((d) => d.img),
          maxBytes,
        )
        store.getState().setEncrypted(ciphertext, key)
      }

      if (!store.getState().fingerprint) {
        store.getState().setPhase('uploading')
        const fp = await uploadPost(store.getState().encryptedBlob!, PUBLIC_TIER_ID, parseWarnings(warnings))
        store.getState().setFingerprint(fp)
      }

      store.getState().setPhase('registering')
      const fp = store.getState().fingerprint!
      const key = store.getState().contentKey!
      await registerContentOnChain(fp, PUBLIC_TIER_ID)
      await markPublic(fp, key)
      useCryptoStore.getState().cachePublicKey(fp, key)
      store.getState().setPhase('done')
    } catch (e) {
      const failedAt = store.getState().phase
      store.getState().setError({ phase: failedAt, message: humanize(e) })
    }
  }

  function writeAnother() {
    imagesRef.current.forEach((d) => URL.revokeObjectURL(d.url))
    setImages([])
    setText('')
    setWarnings('')
    usePipelineStore.getState().clear()
  }

  if (phase === 'done') {
    return (
      <section className={styles.root}>
        <div className={styles.success}>
          <h1 className={styles.title}>Posted.</h1>
          <p className={styles.successBody}>
            Your post is encrypted, uploaded, and registered on-chain. It is public — anyone can
            read it.
          </p>
          <div className={styles.successActions}>
            {proxy && fingerprint && (
              <Link
                to="/$handle/post/$fingerprint"
                params={{ handle: proxy, fingerprint }}
                className={styles.linkButton}
              >
                View post
              </Link>
            )}
            <button type="button" className={styles.primary} onClick={writeAnother}>
              Write another
            </button>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className={styles.root}>
      <h1 className={styles.title}>New post</h1>

      <textarea
        className={styles.text}
        placeholder="Write your post…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={inFlight}
        rows={6}
      />

      <div className={styles.images}>
        {images.map((d) => (
          <div key={d.id} className={styles.thumb}>
            <img src={d.url} alt={d.name} />
            {!inFlight && (
              <button
                type="button"
                className={styles.remove}
                onClick={() => removeImage(d.id)}
                aria-label={`Remove ${d.name}`}
              >
                ×
              </button>
            )}
          </div>
        ))}
        {images.length < MAX_IMAGES && (
          <label className={styles.addImage}>
            <input type="file" accept="image/*" multiple onChange={onFiles} disabled={inFlight} />
            <span>+ Add images</span>
          </label>
        )}
      </div>
      <p className={styles.hint}>
        {images.length}/{MAX_IMAGES} images · up to {(maxBytes / 1_048_576).toFixed(0)} MB per post
      </p>

      <label className={styles.field}>
        <span className={styles.label}>Content warnings (optional)</span>
        <input
          className={styles.input}
          type="text"
          placeholder="e.g. violence, spoilers"
          value={warnings}
          onChange={(e) => setWarnings(e.target.value)}
          disabled={inFlight}
        />
      </label>

      <div className={styles.visibility}>
        <span className={styles.label}>Visibility</span>
        <p className={styles.visibilityValue}>
          Public — readable by anyone, no subscription required.
        </p>
        <p className={styles.hint}>
          Paywalled tiers arrive with tier management. <Link to="/studio/tiers">Set up tiers →</Link>
        </p>
      </div>

      {pipelineError ? (
        <div className={styles.error} role="alert">
          <p>{pipelineError.message}</p>
          <button type="button" className={styles.primary} onClick={runPipeline}>
            Retry
          </button>
        </div>
      ) : inFlight ? (
        <p className={styles.progress}>{PHASE_LABEL[phase]}</p>
      ) : (
        <button
          type="button"
          className={styles.primary}
          onClick={runPipeline}
          disabled={empty}
        >
          Encrypt &amp; post publicly
        </button>
      )}
    </section>
  )
}
