import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '@/components/Placeholder'

// `/studio/access` — access grant declarations. Each grant is signed by the creator's wallet
// (PROTOCOL.md "Access grant signing") and stored both on the instance and on-chain. Declares
// which derivation paths a tier authorises (hierarchical or parallel tiers).
export const Route = createFileRoute('/studio/access')({
  component: AccessGrants,
})

function AccessGrants() {
  return (
    <Placeholder
      title="Access grants"
      blurb="Declare which content paths each tier unlocks. Higher tiers can grant lower-tier access — you sign each declaration."
    />
  )
}
