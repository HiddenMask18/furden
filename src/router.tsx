import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import { emptySession } from './lib/router-context'

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  // Real session is injected per-render by <RouterProvider context={...}> in app.tsx.
  context: { session: emptySession },
  scrollRestoration: true,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
