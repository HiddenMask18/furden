import styles from './Placeholder.module.css'

/**
 * Empty screen for a deliberately deferred feature (v1.x stubs like key rotation and instance
 * migration). Started life as the scaffold placeholder for every route; the blurb now carries
 * the honest "coming in v1.x" copy, so there is no builder's-debris footnote.
 */
export function Placeholder({
  title,
  blurb,
  children,
}: {
  title: string
  blurb?: string
  children?: React.ReactNode
}) {
  return (
    <section className={styles.root}>
      <h1 className={styles.title}>{title}</h1>
      {blurb && <p className={styles.blurb}>{blurb}</p>}
      {children}
    </section>
  )
}
