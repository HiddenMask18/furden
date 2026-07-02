import { useState } from 'react'
import { useAccount, useSignMessage } from 'wagmi'
import { signIn } from '@/lib/auth'
import { useSessionStore } from '@/stores/session'
import styles from './SessionBanner.module.css'

/**
 * Non-blocking sign-in banner (furden-architecture.md §5 step 4 + §2 "Re-authentication is not
 * an error"). Shown when a wallet is connected but no session is live and no sign-in is in
 * flight: after a mid-session 401 ("Your session ended") or after a declined page-load sign-in
 * ("You're not signed in"). Never uses the word "expired". Public content stays reachable —
 * this only offers the way back in.
 */
export function SessionBanner() {
  const { address, status } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const token = useSessionStore((s) => s.token)
  const sessionEnded = useSessionStore((s) => s.sessionEnded)
  const authPending = useSessionStore((s) => s.authPending)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  if (status !== 'connected' || !address || token || authPending) return null

  async function onSignIn() {
    setBusy(true)
    setFailed(false)
    try {
      const ok = await signIn(address!, signMessageAsync)
      if (!ok) setFailed(true)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.banner} role="status">
      <span>{sessionEnded ? 'Your session ended.' : 'You’re not signed in.'}</span>
      <button type="button" className={styles.action} onClick={onSignIn} disabled={busy}>
        {busy ? 'Check your wallet…' : sessionEnded ? 'Sign in again →' : 'Sign in →'}
      </button>
      {failed && (
        <span className={styles.note}>
          Sign-in didn’t complete — it needs a registered wallet and your signature.
        </span>
      )}
    </div>
  )
}
