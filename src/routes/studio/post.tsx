import { useEffect, useRef, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useSignMessage } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import { useGovernanceStore } from '@/stores/governance'
import { usePipelineStore } from '@/stores/pipeline'
import { useCryptoStore } from '@/stores/crypto'
import { useSessionStore } from '@/stores/session'
import { MAX_IMAGES, type EnvelopeImage } from '@/lib/envelope'
import { ApiError } from '@/lib/api'
import { readTiers } from '@/lib/tiers'
import {
  PUBLIC_TIER_ID,
  postSizeLimit,
  buildPublicCiphertext,
  buildPaywalledCiphertext,
  uploadPost,
  registerContentOnChain,
  markPublic,
  ensureAccessGrant,
} from '@/lib/posting'
import styles from './post.module.css'

// `/studio/post` — composer. buildEnvelope(text, images) → encrypt → upload → register → publish
// (§8, PROTOCOL.md "Content posting"). Public posts use a fresh random per-post key (no master
// secret, no grant). Paywalled posts use the tier-derived key and publish an access grant so the
// instance releases the tier key to subscribers; that path needs the master secret in memory.
export const Route = createFileRoute('/studio/post')({
  component: NewPost,
})

type Draft = { id: string; img: EnvelopeImage; url: string; name: string }
type Visibility = 'public' | number // a tier id

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
  const masterSecret = useCryptoStore((s) => s.masterSecret)
  const { signMessageAsync } = useSignMessage()
  const params = useGovernanceStore((s) => s.params)
  const maxBytes = postSizeLimit(params)

  const phase = usePipelineStore((s) => s.phase)
  const pipelineError = usePipelineStore((s) => s.error)
  const fingerprint = usePipelineStore((s) => s.fingerprint)

  const tiersQuery = useQuery({
    queryKey: ['tiers', proxy],
    queryFn: () => readTiers(proxy!),
    enabled: !!proxy,
  })
  const tiers = tiersQuery.data ?? []

  const [text, setText] = useState('')
  const [images, setImages] = useState<Draft[]>([])
  const [warnings, setWarnings] = useState('')
  const [visibility, setVisibility] = useState<Visibility>('public')

  // Revoke preview object URLs on unmount (the canonical bytes live in the drafts, not the URLs).
  const imagesRef = useRef(images)
  imagesRef.current = images
  useEffect(() => () => imagesRef.current.forEach((d) => URL.revokeObjectURL(d.url)), [])

  // A leftover 'done' from a previous visit is stale — this mount is a fresh composer. Error and
  // mid-pipeline states are kept: they carry resumable output the store exists to preserve.
  useEffect(() => {
    if (usePipelineStore.getState().phase === 'done') usePipelineStore.getState().clear()
  }, [])

  const inFlight = phase === 'encrypting' || phase === 'uploading' || phase === 'registering'
  const started = phase !== 'idle' // pipeline has output we must not retarget by changing tier
  const isPublic = visibility === 'public'
  const paywalledBlocked = !isPublic && !masterSecret
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
  // its output, so a Retry after a mid-pipeline failure picks up where it left off.
  async function runPipeline() {
    const store = usePipelineStore
    usePipelineStore.setState({ error: null })
    const tierId = isPublic ? PUBLIC_TIER_ID : (visibility as number)
    try {
      if (!store.getState().encryptedBlob) {
        store.getState().startEncryption(tierId)
        if (isPublic) {
          const { ciphertext, key } = await buildPublicCiphertext(
            text,
            images.map((d) => d.img),
            maxBytes,
          )
          store.getState().setEncrypted(ciphertext, key)
        } else {
          if (!masterSecret) throw new Error('Your keys are not loaded in this session.')
          const ciphertext = await buildPaywalledCiphertext(
            text,
            images.map((d) => d.img),
            masterSecret,
            tierId,
            maxBytes,
          )
          store.getState().setEncrypted(ciphertext, null)
        }
      }

      if (!store.getState().fingerprint) {
        store.getState().setPhase('uploading')
        const fp = await uploadPost(store.getState().encryptedBlob!, tierId, parseWarnings(warnings))
        store.getState().setFingerprint(fp)
      }

      store.getState().setPhase('registering')
      const fp = store.getState().fingerprint!
      await registerContentOnChain(fp, tierId)
      if (isPublic) {
        const key = store.getState().contentKey!
        await markPublic(fp, key)
        useCryptoStore.getState().cachePublicKey(fp, key)
      } else {
        await ensureAccessGrant(proxy!, tierId, signMessageAsync)
      }
      store.getState().setPhase('done')
    } catch (e) {
      const failedAt = store.getState().phase
      store.getState().setError({ phase: failedAt, message: humanize(e) })
    }
  }

  function discardUpload() {
    usePipelineStore.getState().clear()
  }

  function writeAnother() {
    imagesRef.current.forEach((d) => URL.revokeObjectURL(d.url))
    setImages([])
    setText('')
    setWarnings('')
    setVisibility('public')
    usePipelineStore.getState().clear()
  }

  if (phase === 'done') {
    return (
      <section className={styles.root}>
        <div className={styles.success}>
          <h1 className={styles.title}>Posted.</h1>
          <p className={styles.successBody}>
            Your post is encrypted, uploaded, and registered on-chain.{' '}
            {isPublic
              ? 'It is public — anyone can read it.'
              : 'It is paywalled — only subscribers to that tier can decrypt it.'}
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
        <select
          className={styles.input}
          value={isPublic ? 'public' : String(visibility)}
          onChange={(e) =>
            setVisibility(e.target.value === 'public' ? 'public' : Number(e.target.value))
          }
          disabled={started}
        >
          <option value="public">Public — anyone can read it</option>
          {tiers.map((t) => (
            <option key={t.tierId} value={String(t.tierId)}>
              Paywalled — tier {t.tierId}
            </option>
          ))}
        </select>
        {tiers.length === 0 && (
          <p className={styles.hint}>
            No tiers yet. <Link to="/studio/tiers">Set up tiers →</Link> to post paywalled content.
          </p>
        )}
        {paywalledBlocked && (
          <p className={styles.warning}>
            Your keys aren’t loaded in this session. Paywalled posting needs the master secret from
            onboarding, which isn’t recoverable in-browser after a refresh in v1 — post publicly, or
            onboard again in this session.
          </p>
        )}
      </div>

      {pipelineError ? (
        <div className={styles.error} role="alert">
          <p>{pipelineError.message}</p>
          <div className={styles.errorActions}>
            <button type="button" className={styles.primary} onClick={runPipeline}>
              Retry
            </button>
            <button type="button" className={styles.ghost} onClick={discardUpload}>
              Discard &amp; edit
            </button>
          </div>
        </div>
      ) : inFlight ? (
        <p className={styles.progress}>{PHASE_LABEL[phase]}</p>
      ) : (
        <button
          type="button"
          className={styles.primary}
          onClick={runPipeline}
          disabled={empty || paywalledBlocked}
        >
          {isPublic ? 'Encrypt & post publicly' : `Encrypt & post to tier ${visibility}`}
        </button>
      )}
    </section>
  )
}
