import { createRootRouteWithContext, Link, Outlet, useRouterState } from '@tanstack/react-router'
import type { RouterContext } from '@/lib/router-context'
import { ChainIndicator } from '@/components/ChainIndicator'
import { WalletBadge } from '@/components/WalletBadge'
import styles from './__root.module.css'

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
})

function RootLayout() {
  const { session } = Route.useRouteContext()
  // The studio renders its own side-rail chrome; hide the top bar nav links there.
  const inStudio = useRouterState({ select: (s) => s.location.pathname.startsWith('/studio') })

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link to="/" className={styles.brand}>
          furden
        </Link>
        {!inStudio && (
          <nav className={styles.nav}>
            <Link to="/about" className={styles.link}>
              About
            </Link>
            {session.token && (
              <>
                <Link to="/feed" className={styles.link}>
                  Feed
                </Link>
                <Link to="/subscriptions" className={styles.link}>
                  Subscriptions
                </Link>
              </>
            )}
            {session.isCreator && (
              <Link to="/studio" className={styles.link}>
                Studio
              </Link>
            )}
          </nav>
        )}
        <div className={styles.right}>
          <ChainIndicator />
          <WalletBadge />
        </div>
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  )
}
