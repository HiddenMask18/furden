import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { ConnectModal } from '@/components/ConnectModal'
import styles from './connect.module.css'

// `/connect` — wallet connection entry and the redirect target for gated routes (§6). Gated
// routes pass `from` = the path that bounced the user here. We only accept internal paths
// (leading slash) to avoid an open-redirect via a crafted `from`.
export const Route = createFileRoute('/connect')({
  validateSearch: (search: Record<string, unknown>): { from?: string } => ({
    from:
      typeof search.from === 'string' && search.from.startsWith('/') ? search.from : undefined,
  }),
  component: Connect,
})

function Connect() {
  const { from } = Route.useSearch()
  const router = useRouter()
  const [open, setOpen] = useState(true)

  return (
    <>
      <section className={styles.root}>
        <h1 className={styles.title}>Connect your wallet</h1>
        <p className={styles.blurb}>
          Your wallet is your key. Connect to sign in to your DEN session — wallet connection is
          requested only at the point you act, never to browse a public profile.
        </p>
      </section>
      <ConnectModal
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          // Cancelled without connecting. Go home rather than back to `from`: a gated `from`
          // would just bounce the user straight back here and re-open the modal.
          if (!next) router.history.push('/')
        }}
        // Connected. Return to wherever they were headed; SessionBridge (§5) fires the
        // signature prompt, and the destination shows a loading state until the session resolves.
        onConnected={() => router.history.push(from ?? '/')}
      />
    </>
  )
}
