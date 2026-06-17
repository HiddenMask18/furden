import { createFileRoute, redirect } from '@tanstack/react-router'
import { Placeholder } from '@/components/Placeholder'

// `/settings` — subscriber guard. Account-level settings for a connected participant.
export const Route = createFileRoute('/settings')({
  beforeLoad: ({ context, location }) => {
    if (!context.session.token) {
      throw redirect({ to: '/connect', search: { from: location.href } })
    }
  },
  component: Settings,
})

function Settings() {
  return <Placeholder title="Settings" blurb="Your connected wallet, session, and preferences." />
}
