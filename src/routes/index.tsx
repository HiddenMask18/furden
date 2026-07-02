import { useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useSessionStore } from '@/stores/session'
import styles from './index.module.css'

// `/` — static landing page (§ Appendix A "Static landing page"). No instance-backed discovery:
// the instance exposes no creator listing or trending query. DEN is a destination — you arrive
// with a creator's name from wherever they post — so the page's job is what-is-this plus entry
// points: open a creator's page, go to your feed, or set up a studio. Public, no auth required.
export const Route = createFileRoute('/')({
  component: Landing,
})

function Landing() {
  const token = useSessionStore((s) => s.token)
  const isCreator = useSessionStore((s) => s.isCreator)
  const navigate = useNavigate()
  const [lookup, setLookup] = useState('')

  function openCreator(e: React.FormEvent) {
    e.preventDefault()
    const handle = lookup.trim().replace(/^@/, '')
    if (!handle) return
    navigate({ to: '/$handle', params: { handle } })
  }

  return (
    <section className={styles.root}>
      <div className={styles.hero}>
        <h1 className={styles.title}>Your content is encrypted here, in your browser.</h1>
        <p className={styles.blurb}>
          DEN is a protocol for end-to-end encrypted content subscription. No platform sits
          between a creator and the people who pay them: hosters store ciphertext they cannot
          read, creators hold their own keys, and payment happens on-chain, wallet to wallet.
          This is furden, the reference client.
        </p>
      </div>

      <div className={styles.paths}>
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Following a creator?</h2>
          <p className={styles.cardBody}>
            There is no discovery feed and no algorithm here. You find creators where they
            already post, and arrive with their name. Enter it to open their page.
          </p>
          <form className={styles.lookup} onSubmit={openCreator}>
            <input
              className={styles.input}
              type="text"
              placeholder="handle or 0x… address"
              value={lookup}
              onChange={(e) => setLookup(e.target.value)}
              aria-label="Creator handle or address"
            />
            <button type="submit" className={styles.primary} disabled={lookup.trim() === ''}>
              Open profile
            </button>
          </form>
          {token ? (
            <p className={styles.cardLinks}>
              <Link to="/feed" className={styles.link}>
                Your feed →
              </Link>
              <Link to="/subscriptions" className={styles.link}>
                Your subscriptions →
              </Link>
            </p>
          ) : (
            <p className={styles.cardLinks}>
              Already subscribe to someone?{' '}
              <Link to="/connect" search={{ from: '/feed' }} className={styles.link}>
                Connect your wallet →
              </Link>
            </p>
          )}
        </div>

        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Are you a creator?</h2>
          <p className={styles.cardBody}>
            Register an identity no platform can take away, encrypt your work to keys only you
            hold, and set your own prices in the tokens you choose. Your subscribers are yours —
            if a host disappears, you migrate with your keys and your audience intact.
          </p>
          <p className={styles.cardLinks}>
            {isCreator ? (
              <Link to="/studio" className={styles.link}>
                Open your studio →
              </Link>
            ) : (
              <Link to="/onboard" className={styles.link}>
                Set up your studio →
              </Link>
            )}
          </p>
        </div>
      </div>

      <p className={styles.footnote}>
        New to all of this?{' '}
        <Link to="/about" className={styles.link}>
          What is DEN →
        </Link>
      </p>
    </section>
  )
}
