import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useAccount, useSignMessage } from 'wagmi'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ConnectModal } from '@/components/ConnectModal'
import { signIn } from '@/lib/auth'
import {
  isWalletRegistered,
  registerIdentity,
  provisionCreatorKeys,
  readInstanceUrl,
  setInstanceUrl,
} from '@/lib/onboarding'
import { ApiError } from '@/lib/api'
import { readHandle } from '@/lib/resolve'
import { setHandle as setHandleOnChain } from '@/lib/settings'
import { useSessionStore } from '@/stores/session'
import { useCryptoStore } from '@/stores/crypto'
import { env } from '@/lib/env'
import styles from './onboard.module.css'

// `/onboard` — creator onboarding wizard (PROTOCOL.md "Creator onboarding", DESIGN.md Flow 2).
// Deliberately NOT behind the subscriber guard: a brand-new creator is unregistered and so cannot
// authenticate yet (the instance 401s unregistered wallets) — the wizard itself drives
// register() → auth → key provisioning → instance URL. The current stage is derived from live
// wallet/session/chain state so a half-finished creator resumes exactly where they left off.
export const Route = createFileRoute('/onboard')({
  component: Onboard,
})

type Stage = 'connect' | 'register' | 'authenticate' | 'keys' | 'instance' | 'handle' | 'done'
const ORDER: Stage[] = ['connect', 'register', 'authenticate', 'keys', 'instance', 'handle', 'done']

const STEPS: { stage: Stage; title: string; blurb: string }[] = [
  {
    stage: 'connect',
    title: 'Connect your wallet',
    blurb: 'Your wallet is your identity and the root of every key. No email, no password, no reset.',
  },
  {
    stage: 'register',
    title: 'Register your DEN identity',
    blurb:
      'A one-time on-chain transaction deploys your identity proxy. The address is permanent — it is who you are on DEN.',
  },
  {
    stage: 'authenticate',
    title: 'Sign in to your instance',
    blurb: 'Sign a challenge to open a session with your home instance. Nothing is spent.',
  },
  {
    stage: 'keys',
    title: 'Generate and back up your keys',
    blurb:
      'Your master secret is generated in this browser, encrypted to your instance and to your wallet, and never leaves in plaintext. Recovery runs through your wallet — you can add an emergency wallet later in Settings.',
  },
  {
    stage: 'instance',
    title: 'Publish your instance URL',
    blurb:
      'Record your home instance on-chain so others can resolve your content. Your instance countersigns this.',
  },
  {
    stage: 'handle',
    title: 'Pick a handle (optional)',
    blurb:
      'A human-readable name for your profile, recorded on-chain. Entirely optional — without one, your page still works and resolves by your address. Changes are rate-limited, so choose with some care.',
  },
]

function humanize(e: unknown): string {
  if (e instanceof ApiError) return e.message
  const msg = e instanceof Error ? e.message : String(e)
  if (/user rejected|rejected|denied|4001/i.test(msg)) return 'Cancelled in your wallet.'
  return msg
}

function Onboard() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { address, status } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const session = useSessionStore()

  const [connectOpen, setConnectOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [urlWarning, setUrlWarning] = useState<string | null>(null)
  const [skippedUrl, setSkippedUrl] = useState(false)
  const [handleInput, setHandleInput] = useState('')
  const [skippedHandle, setSkippedHandle] = useState(false)

  // Chain reads live in TanStack Query (§9). Registration gates the early stages; the recorded
  // instance URL gates the final one. Each is enabled only once its inputs exist.
  const registeredQuery = useQuery({
    queryKey: ['isRegistered', address],
    queryFn: () => isWalletRegistered(address!),
    enabled: status === 'connected' && !!address,
  })
  const instanceUrlQuery = useQuery({
    queryKey: ['instanceURL', session.proxy],
    queryFn: () => readInstanceUrl(session.proxy!),
    enabled: !!session.proxy && !!session.token && session.isCreator,
  })
  const handleQuery = useQuery({
    queryKey: ['handle', session.proxy],
    queryFn: () => readHandle(session.proxy!),
    enabled: !!session.proxy && !!session.token && session.isCreator,
  })

  const registered = registeredQuery.data
  const urlOnChain = instanceUrlQuery.data
  const urlDone = skippedUrl || (urlOnChain != null && urlOnChain === env.instanceUrl)
  // handleOf returns "" for handleless — a valid final state, so only a set handle or an explicit
  // skip completes the step (it cannot be derived from chain state alone).
  const handleDone = skippedHandle || !!handleQuery.data

  let stage: Stage
  if (status !== 'connected') stage = 'connect'
  else if (registered !== true) stage = 'register'
  else if (!session.token) stage = 'authenticate'
  else if (!session.isCreator) stage = 'keys'
  else if (!urlDone) stage = 'instance'
  else if (!handleDone) stage = 'handle'
  else stage = 'done'

  // Onboarding complete — hand off to the studio (its guard now passes: session + isCreator).
  useEffect(() => {
    if (stage === 'done') navigate({ to: '/studio' })
  }, [stage, navigate])

  // Don't carry a stale error from one step onto the next.
  useEffect(() => {
    setError(null)
  }, [stage])

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(humanize(e))
    } finally {
      setBusy(false)
    }
  }

  const onRegister = () =>
    run(async () => {
      await registerIdentity()
      await qc.invalidateQueries({ queryKey: ['isRegistered', address] })
    })

  const onAuthenticate = () =>
    run(async () => {
      const ok = await signIn(address!, signMessageAsync)
      if (!ok) throw new Error('Sign-in failed — make sure this wallet is registered.')
    })

  const onProvision = () =>
    run(async () => {
      const masterSecret = await provisionCreatorKeys(signMessageAsync)
      useCryptoStore.getState().setMasterSecret(masterSecret)
      useSessionStore.getState().setIsCreator(true)
    })

  const onPublishUrl = () =>
    run(async () => {
      setUrlWarning(null)
      try {
        await setInstanceUrl(session.proxy!)
        await qc.invalidateQueries({ queryKey: ['instanceURL', session.proxy] })
      } catch (e) {
        // Most common locally: the instance operator isn't registered yet (503), so it cannot
        // countersign. Non-fatal — the keys are already live; surface a warning and offer Skip.
        setUrlWarning(
          e instanceof ApiError && e.status === 503
            ? 'Your instance has not confirmed your URL yet — operator setup may still be pending. You can publish it later from Settings.'
            : humanize(e),
        )
        throw e
      }
    })

  const onSetHandle = () =>
    run(async () => {
      await setHandleOnChain(handleInput.trim())
      await qc.invalidateQueries({ queryKey: ['handle', session.proxy] })
    })

  const currentIndex = ORDER.indexOf(stage)

  return (
    <section className={styles.root}>
      <header className={styles.head}>
        <h1 className={styles.title}>Set up your studio</h1>
        <p className={styles.lead}>
          Six steps to a creator identity you fully own. Two are on-chain transactions — three if
          you pick a handle; the rest happen in this browser. Your keys never leave in plaintext.
        </p>
      </header>

      <ol className={styles.steps}>
        {STEPS.map((step, i) => {
          const state = i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'pending'
          return (
            <li key={step.stage} className={styles.step} data-state={state}>
              <span className={styles.marker} aria-hidden>
                {state === 'done' ? '✓' : i + 1}
              </span>
              <div className={styles.body}>
                <h2 className={styles.stepTitle}>{step.title}</h2>
                <p className={styles.stepBlurb}>{step.blurb}</p>

                {state === 'current' && (
                  <div className={styles.action}>
                    {step.stage === 'connect' && (
                      <button
                        type="button"
                        className={styles.primary}
                        onClick={() => setConnectOpen(true)}
                      >
                        Connect wallet
                      </button>
                    )}

                    {step.stage === 'register' && (
                      <button
                        type="button"
                        className={styles.primary}
                        onClick={onRegister}
                        disabled={busy || registeredQuery.isLoading}
                      >
                        {busy
                          ? 'Confirm in your wallet…'
                          : registeredQuery.isLoading
                            ? 'Checking…'
                            : 'Register identity'}
                      </button>
                    )}

                    {step.stage === 'authenticate' && (
                      <button
                        type="button"
                        className={styles.primary}
                        onClick={onAuthenticate}
                        disabled={busy}
                      >
                        {busy ? 'Sign in your wallet…' : 'Sign in'}
                      </button>
                    )}

                    {step.stage === 'keys' && (
                      <button
                        type="button"
                        className={styles.primary}
                        onClick={onProvision}
                        disabled={busy}
                      >
                        {busy ? 'Encrypting & uploading…' : 'Generate my keys'}
                      </button>
                    )}

                    {step.stage === 'instance' && (
                      <div className={styles.row}>
                        <button
                          type="button"
                          className={styles.primary}
                          onClick={onPublishUrl}
                          disabled={busy || instanceUrlQuery.isLoading}
                        >
                          {busy ? 'Confirm in your wallet…' : 'Publish instance URL'}
                        </button>
                        <button
                          type="button"
                          className={styles.skip}
                          onClick={() => setSkippedUrl(true)}
                          disabled={busy}
                        >
                          Skip for now
                        </button>
                      </div>
                    )}

                    {step.stage === 'handle' && (
                      <div className={styles.row}>
                        <input
                          className={styles.input}
                          type="text"
                          placeholder="yourname"
                          value={handleInput}
                          onChange={(e) => setHandleInput(e.target.value)}
                          disabled={busy}
                        />
                        <button
                          type="button"
                          className={styles.primary}
                          onClick={onSetHandle}
                          disabled={busy || handleInput.trim() === ''}
                        >
                          {busy ? 'Confirm in your wallet…' : 'Set handle'}
                        </button>
                        <button
                          type="button"
                          className={styles.skip}
                          onClick={() => setSkippedHandle(true)}
                          disabled={busy}
                        >
                          Skip — stay handleless
                        </button>
                      </div>
                    )}

                    {error && (
                      <p className={styles.error} role="alert">
                        {error}
                      </p>
                    )}
                    {step.stage === 'instance' && urlWarning && (
                      <p className={styles.warning}>{urlWarning}</p>
                    )}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ol>

      <ConnectModal
        open={connectOpen}
        onOpenChange={setConnectOpen}
        onConnected={() => setConnectOpen(false)}
      />
    </section>
  )
}
