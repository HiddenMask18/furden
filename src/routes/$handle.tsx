import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '@/components/Placeholder'

// `/$handle` — creator profile (public + subscriber view). The param is a handle or proxy
// address: if it matches /^0x[0-9a-fA-F]{40}$/ use it directly, else resolve on-chain via
// DENIdentityRegistry.resolve(handle) (§6), then GET /profile/:proxy. No login wall to view.
export const Route = createFileRoute('/$handle')({
  component: CreatorProfile,
})

function CreatorProfile() {
  const { handle } = Route.useParams()
  return (
    <Placeholder title="Creator profile" blurb="Public tiers, pricing, public preview content, and content warnings render here without any wallet connection.">
      <p className="mono">handle/proxy: {handle}</p>
    </Placeholder>
  )
}
