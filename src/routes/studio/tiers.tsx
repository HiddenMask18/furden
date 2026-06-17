import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '@/components/Placeholder'

// `/studio/tiers` — subscription tier management. DENSubscription.setTier(tierId, price,
// duration, token). Real tiers number from 1 (tier 0 is reserved for public content).
export const Route = createFileRoute('/studio/tiers')({
  component: Tiers,
})

function Tiers() {
  return (
    <Placeholder
      title="Tiers"
      blurb="Define what subscribers pay, in any supported token, and for how long."
    />
  )
}
