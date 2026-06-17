import styles from './Placeholder.module.css'

/**
 * Scaffold placeholder for a not-yet-implemented screen. Each route renders one of these so the
 * route tree, guards, and navigation are wired and walkable before any feature work lands.
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
      <p className={styles.stub}>Not built yet — scaffold placeholder.</p>
    </section>
  )
}
