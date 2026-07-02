import { createFileRoute, Link } from '@tanstack/react-router'
import styles from './about.module.css'

// `/about` — what DEN is, for people who arrived at a creator's page and don't know the
// protocol. Static, public, manifesto voice. Ends in the same entry points as the landing page.
export const Route = createFileRoute('/about')({
  component: About,
})

function About() {
  return (
    <section className={styles.root}>
      <h1 className={styles.title}>What is DEN</h1>

      <p className={styles.body}>
        DEN is a protocol for end-to-end encrypted content subscription. It exists because
        payment processors and platform policies keep deciding which art is allowed to earn a
        living — and artists keep losing their income overnight to rule changes they had no say
        in. DEN removes the party that makes those decisions.
      </p>

      <p className={styles.body}>There are three kinds of participants, and the split is the point:</p>

      <ul className={styles.list}>
        <li>
          <strong>Hosters</strong> run instances and store only ciphertext. A hoster cannot read
          the content it serves, so it cannot be pressured over what that content is.
        </li>
        <li>
          <strong>Creators</strong> hold their own keys, their identity, and their subscriber
          relationships — all anchored on-chain, none of it borrowed from a platform. If a host
          disappears, a creator migrates and loses nothing.
        </li>
        <li>
          <strong>Subscribers</strong> pay creators directly on-chain, wallet to wallet, and are
          the only ones who can decrypt what they paid for.
        </li>
      </ul>

      <p className={styles.body}>
        Everything cryptographic happens in your browser: content is encrypted before it is
        uploaded and decrypted after it is downloaded. Your wallet is your identity — no email,
        no password, no account to suspend.
      </p>

      <p className={styles.body}>
        No card networks, no processors, no platform cut taken by a company with a trust-and-safety
        department pointed at your art. Subscriptions are priced in the tokens creators choose, on{' '}
        Base, an Ethereum L2 where transactions cost cents.
      </p>

      <div className={styles.ctas}>
        <Link to="/onboard" className={styles.primary}>
          Set up your studio
        </Link>
        <Link to="/" className={styles.link}>
          Find a creator →
        </Link>
        <a
          href="https://github.com/HiddenMask18/den-protocol"
          target="_blank"
          rel="noreferrer"
          className={styles.link}
        >
          Read the protocol ↗
        </a>
      </div>
    </section>
  )
}
