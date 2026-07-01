import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { isAddress, type Address } from 'viem'
import { ApiError, creator as creatorApi, profile } from '@/lib/api'
import { readHandle } from '@/lib/resolve'
import {
  readHandleChangeStatus,
  setHandle,
  readEmergencyWallet,
  registerEmergencyWallet,
} from '@/lib/settings'
import { useSessionStore } from '@/stores/session'
import styles from './settings.module.css'

// `/studio/settings` — handle, bio, emergency wallet. The emergency wallet is the recovery path
// (Appendix A "Portability-blob recovery"); registering one designates it on-chain.
export const Route = createFileRoute('/studio/settings')({
  component: StudioSettings,
})

function humanize(e: unknown): string {
  if (e instanceof ApiError) return e.message
  const msg = e instanceof Error ? e.message : String(e)
  if (/user rejected|rejected|denied|4001/i.test(msg)) return 'Cancelled in your wallet.'
  return msg
}

/** Shared run wrapper: busy/error/ok state around one async action. */
function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    setOk(false)
    try {
      await fn()
      setOk(true)
    } catch (e) {
      setError(humanize(e))
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, ok, run, clearOk: () => setOk(false) }
}

function HandleSection({ proxy }: { proxy: Address }) {
  const qc = useQueryClient()
  const { busy, error, ok, run, clearOk } = useAction()
  const [value, setValue] = useState<string | null>(null)

  const handleQuery = useQuery({ queryKey: ['handle', proxy], queryFn: () => readHandle(proxy) })
  const statusQuery = useQuery({
    queryKey: ['handleChangeStatus', proxy],
    queryFn: () => readHandleChangeStatus(proxy),
  })

  const current = handleQuery.data || ''
  const input = value ?? current
  const trimmed = input.trim()
  const changed = trimmed !== current && trimmed.length > 0
  const noneLeft = statusQuery.data?.remaining === 0

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Handle</h2>
      <p className={styles.hint}>
        Your public name on DEN. It resolves to your identity on-chain; anyone can find you by it.
      </p>

      <input
        className={styles.input}
        value={input}
        placeholder="yourname"
        onChange={(e) => {
          setValue(e.target.value)
          clearOk()
        }}
        disabled={busy}
        autoCapitalize="none"
        spellCheck={false}
      />

      {/* The first handle is free — the allowance only governs *changes* (contract setHandle). */}
      {current && statusQuery.data && (
        <p className={styles.meta}>
          {statusQuery.data.remaining} of {statusQuery.data.allowance} change
          {statusQuery.data.allowance === 1 ? '' : 's'} left this period.
        </p>
      )}

      <button
        type="button"
        className={styles.primary}
        disabled={busy || !changed || noneLeft || handleQuery.isPending}
        onClick={() =>
          run(async () => {
            await setHandle(trimmed)
            setValue(null)
            await Promise.all([
              qc.invalidateQueries({ queryKey: ['handle', proxy] }),
              qc.invalidateQueries({ queryKey: ['handleChangeStatus', proxy] }),
            ])
          })
        }
      >
        {busy ? 'Confirm in your wallet…' : current ? 'Change handle' : 'Set handle'}
      </button>

      {noneLeft && <p className={styles.meta}>No changes left this period.</p>}
      {ok && <p className={styles.ok}>Handle updated.</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </section>
  )
}

function BioSection({ proxy }: { proxy: Address }) {
  const qc = useQueryClient()
  const { busy, error, ok, run, clearOk } = useAction()
  const [value, setValue] = useState<string | null>(null)

  const profileQuery = useQuery({ queryKey: ['profile', proxy], queryFn: () => profile.get(proxy) })

  const current = profileQuery.data?.bio ?? ''
  const input = value ?? current
  const changed = input !== current

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Bio</h2>
      <p className={styles.hint}>A short description shown on your public profile. Stored on this instance.</p>

      <textarea
        className={styles.textarea}
        value={input}
        rows={4}
        placeholder="Tell subscribers what you make…"
        onChange={(e) => {
          setValue(e.target.value)
          clearOk()
        }}
        disabled={busy || profileQuery.isPending}
      />

      <button
        type="button"
        className={styles.primary}
        disabled={busy || !changed || profileQuery.isPending}
        onClick={() =>
          run(async () => {
            const next = input.trim()
            await creatorApi.setProfile(next.length ? next : null)
            setValue(null)
            await qc.invalidateQueries({ queryKey: ['profile', proxy] })
          })
        }
      >
        {busy ? 'Saving…' : 'Save bio'}
      </button>

      {ok && <p className={styles.ok}>Bio saved.</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </section>
  )
}

function EmergencySection({ proxy }: { proxy: Address }) {
  const qc = useQueryClient()
  const { busy, error, ok, run, clearOk } = useAction()
  const [value, setValue] = useState('')

  const currentQuery = useQuery({
    queryKey: ['emergencyWallet', proxy],
    queryFn: () => readEmergencyWallet(proxy),
  })
  const current = currentQuery.data

  const trimmed = value.trim()
  const valid = isAddress(trimmed)
  const changed = valid && trimmed.toLowerCase() !== (current ?? '').toLowerCase()

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Emergency wallet</h2>
      <p className={styles.hint}>
        A second wallet that can recover your identity if you lose access to this one. Designating it
        here records it on-chain.
      </p>

      {currentQuery.isPending ? (
        <p className={styles.meta}>Reading…</p>
      ) : current ? (
        <p className={styles.meta}>
          Current: <code className={styles.mono}>{current}</code>
        </p>
      ) : (
        <p className={styles.meta}>None registered.</p>
      )}

      <input
        className={styles.input}
        value={value}
        placeholder="0x…"
        onChange={(e) => {
          setValue(e.target.value)
          clearOk()
        }}
        disabled={busy}
        spellCheck={false}
      />
      {trimmed.length > 0 && !valid && <p className={styles.meta}>Not a valid address.</p>}

      <button
        type="button"
        className={styles.primary}
        disabled={busy || !changed}
        onClick={() =>
          run(async () => {
            await registerEmergencyWallet(proxy, trimmed as Address)
            setValue('')
            await qc.invalidateQueries({ queryKey: ['emergencyWallet', proxy] })
          })
        }
      >
        {busy ? 'Confirm in your wallet…' : 'Register emergency wallet'}
      </button>

      <p className={styles.note}>
        This grants the wallet on-chain recovery power over your identity. Encrypting a recovery copy
        of your content keys to it is a separate step that needs that wallet connected to sign — not
        yet automated in v1.
      </p>

      {ok && <p className={styles.ok}>Emergency wallet registered.</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </section>
  )
}

function StudioSettings() {
  const proxy = useSessionStore((s) => s.proxy)
  if (!proxy) return null

  return (
    <div className={styles.root}>
      <h1 className={styles.title}>Settings</h1>
      <HandleSection proxy={proxy} />
      <BioSection proxy={proxy} />
      <EmergencySection proxy={proxy} />
    </div>
  )
}
