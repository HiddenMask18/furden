import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '@/components/Placeholder'

// `/studio/settings` — handle, bio, emergency wallet. The emergency wallet is the recovery path
// (Appendix A "Portability-blob recovery"); registering one writes an emergency portability blob.
export const Route = createFileRoute('/studio/settings')({
  component: StudioSettings,
})

function StudioSettings() {
  return (
    <Placeholder
      title="Studio settings"
      blurb="Your handle, bio, and emergency wallet — the wallet that can recover your keys."
    />
  )
}
