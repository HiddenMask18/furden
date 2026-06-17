import { createFileRoute, redirect } from '@tanstack/react-router'
import { Placeholder } from '@/components/Placeholder'

// `/subscriptions` — subscriber guard. Enumerated from on-chain `Subscribed` logs; current
// expiry read live per subscription (§9). Creators hosted on another instance appear as honest
// link-outs ("Hosted on another DEN site → Open"), never a broken-subscription screen.
export const Route = createFileRoute('/subscriptions')({
  beforeLoad: ({ context, location }) => {
    if (!context.session.token) {
      throw redirect({ to: '/connect', search: { from: location.href } })
    }
  },
  component: Subscriptions,
})

function Subscriptions() {
  return (
    <Placeholder
      title="Subscriptions"
      blurb="Every creator you support, with renewal dates read live from chain. Off-instance creators link out to their home site."
    />
  )
}
