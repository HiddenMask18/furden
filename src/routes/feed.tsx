import { createFileRoute, redirect } from '@tanstack/react-router'
import { Placeholder } from '@/components/Placeholder'

// `/feed` — subscriber guard. Assembled client-side from on-chain `Subscribed` logs (§9): one
// getLogs by subscriberProxy → creators, filter to the configured instance, fetch inventory +
// keys per (creator, tier), merge by timestamp DESC, decrypt progressively.
export const Route = createFileRoute('/feed')({
  beforeLoad: ({ context, location }) => {
    if (!context.session.token) {
      throw redirect({ to: '/connect', search: { from: location.href } })
    }
  },
  component: Feed,
})

function Feed() {
  return (
    <Placeholder
      title="Your feed"
      blurb="Posts from every creator you subscribe to on this instance, newest first."
    />
  )
}
