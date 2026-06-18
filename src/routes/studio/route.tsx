import { createFileRoute, redirect, Link, Outlet } from '@tanstack/react-router'
import styles from './route.module.css'

// Creator guard on the studio layout — every `/studio/*` route inherits it (§6). A connected
// participant who has not completed creator setup on this instance is sent to /onboard.
export const Route = createFileRoute('/studio')({
  beforeLoad: ({ context, location }) => {
    if (!context.session.token) {
      throw redirect({ to: '/connect', search: { from: location.href } })
    }
    if (!context.session.isCreator) {
      throw redirect({ to: '/onboard' })
    }
  },
  component: StudioLayout,
})

const NAV = [
  { to: '/studio', label: 'Dashboard', exact: true },
  { to: '/studio/post', label: 'New post' },
  { to: '/studio/content', label: 'Content library' },
  { to: '/studio/tiers', label: 'Tiers' },
  { to: '/studio/access', label: 'Access grants' },
  { to: '/studio/settings', label: 'Settings' },
  { to: '/studio/keys', label: 'Keys' },
  { to: '/studio/migrate', label: 'Migrate' },
] as const

function StudioLayout() {
  return (
    <div className={styles.studio}>
      <aside className={styles.rail}>
        <p className={styles.railHeading}>Studio</p>
        <nav className={styles.railNav}>
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: 'exact' in item ? item.exact : false }}
              activeProps={{ className: styles.active }}
              className={styles.railLink}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <section className={styles.content}>
        <Outlet />
      </section>
    </div>
  )
}
