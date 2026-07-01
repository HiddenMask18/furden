import { useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useSignMessage } from 'wagmi'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Address } from 'viem'
import { ApiError } from '@/lib/api'
import { readTiers } from '@/lib/tiers'
import {
  changeVisibility,
  type VisibilityPhase,
  type VisibilityProgress,
  type VisibilityTarget,
} from '@/lib/visibility'
import type { LibraryItem } from '@/routes/studio/content'
import styles from './VisibilityDialog.module.css'

/**
 * Change one post's visibility (PROTOCOL.md "Visibility changes are re-encryption events"). This is
 * a pipeline of chain transactions, not a toggle: the dialog presents it with that weight and is
 * explicit that returning a post to paywalled does not un-publish what was already public. Assumes
 * the master secret is in memory — the caller gates the entry point on it.
 */
type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  creatorProxy: Address
  masterSecret: Uint8Array
  item: LibraryItem
}

const PHASES: { key: VisibilityPhase; label: string }[] = [
  { key: 'reencrypt', label: 'Re-encrypt' },
  { key: 'upload', label: 'Upload' },
  { key: 'register', label: 'Register' },
  { key: 'publish', label: 'Publish' },
  { key: 'cleanup', label: 'Retire old' },
]

function humanize(e: unknown): string {
  if (e instanceof ApiError) return e.message
  const msg = e instanceof Error ? e.message : String(e)
  if (/user rejected|rejected|denied|4001/i.test(msg)) return 'Cancelled in your wallet.'
  return msg
}

export function VisibilityDialog({ open, onOpenChange, creatorProxy, masterSecret, item }: Props) {
  const qc = useQueryClient()
  const { signMessageAsync } = useSignMessage()

  const toPublic = !item.isPublic // public posts go paywalled; paywalled posts go public
  const [tierId, setTierId] = useState<number | null>(null)
  const [phase, setPhase] = useState<VisibilityPhase | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const progressRef = useRef<VisibilityProgress>({})

  // Tiers are only needed when moving a public post behind a paywall.
  const tiersQuery = useQuery({
    queryKey: ['tiers', creatorProxy],
    queryFn: () => readTiers(creatorProxy),
    enabled: open && !toPublic,
  })
  const tiers = tiersQuery.data ?? []
  const selectedTier = tierId ?? (tiers.length ? tiers[0].tierId : null)

  const target: VisibilityTarget | null = toPublic
    ? { kind: 'public' }
    : selectedTier != null
      ? { kind: 'paywalled', tierId: selectedTier }
      : null

  async function run() {
    if (!target) return
    setBusy(true)
    setError(null)
    try {
      await changeVisibility(
        {
          creatorProxy,
          oldFingerprint: item.fingerprint,
          oldTierId: item.tierId,
          oldIsPublic: item.isPublic,
          oldPublicKeyHex: item.publicKeyHex,
          warnings: item.warnings,
          masterSecret,
          target,
          signRaw: signMessageAsync,
          onPhase: setPhase,
        },
        progressRef.current,
      )
      setDone(true)
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['library', creatorProxy] }),
        qc.invalidateQueries({ queryKey: ['profile', creatorProxy] }),
      ])
    } catch (e) {
      setError(humanize(e))
    } finally {
      setBusy(false)
      setPhase(null)
    }
  }

  const noTiers = !toPublic && !tiersQuery.isPending && tiers.length === 0

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.content}>
          <Dialog.Title className={styles.title}>
            {done ? 'Visibility changed' : toPublic ? 'Make this post public' : 'Move behind a paywall'}
          </Dialog.Title>

          {done ? (
            <>
              <p className={styles.body}>
                {toPublic
                  ? 'The post is re-encrypted and public. Its key is published, so anyone can read it.'
                  : 'The post is re-encrypted under the tier key going forward. The previously public copy stays disclosed — see below.'}
              </p>
              <button type="button" className={styles.primary} onClick={() => onOpenChange(false)}>
                Done
              </button>
            </>
          ) : (
            <>
              <Dialog.Description className={styles.body}>
                {toPublic
                  ? 'This re-encrypts the post with a fresh public key and publishes that key. Anyone will be able to read it, with no subscription.'
                  : 'This re-encrypts the post under a tier key and registers a new copy. It does not un-publish the old one: the previous key was already public, so anyone who saved it keeps access. Making a post private again protects nothing that was already public.'}
              </Dialog.Description>

              {!toPublic && (
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Tier</span>
                  <select
                    className={styles.select}
                    value={selectedTier ?? ''}
                    onChange={(e) => setTierId(Number(e.target.value))}
                    disabled={busy || noTiers}
                  >
                    {tiers.map((t) => (
                      <option key={t.tierId} value={t.tierId}>
                        Tier {t.tierId}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {noTiers ? (
                <p className={styles.note}>Create a tier first, then move this post behind it.</p>
              ) : (
                <ol className={styles.steps}>
                  {PHASES.map((p) => (
                    <li key={p.key} data-active={phase === p.key}>
                      {p.label}
                    </li>
                  ))}
                </ol>
              )}

              <button
                type="button"
                className={styles.primary}
                onClick={run}
                disabled={busy || noTiers || !target || (!toPublic && tiersQuery.isPending)}
              >
                {busy
                  ? 'Confirm in your wallet…'
                  : progressRef.current.newFingerprint
                    ? 'Retry'
                    : toPublic
                      ? 'Re-encrypt and publish'
                      : 'Re-encrypt and paywall'}
              </button>

              {error && (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              )}
            </>
          )}

          <Dialog.Close className={styles.close} aria-label="Close">
            ×
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
