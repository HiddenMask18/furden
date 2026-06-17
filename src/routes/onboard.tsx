import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '@/components/Placeholder'

// `/onboard` — creator onboarding wizard (PROTOCOL.md "Creator onboarding", DESIGN.md Flow 2).
// register() → auth → blob-pubkey → generate + encrypt master secret → upload blobs → set URL.
export const Route = createFileRoute('/onboard')({
  component: Onboard,
})

function Onboard() {
  return (
    <Placeholder
      title="Set up your studio"
      blurb="Generate your master secret, encrypt it in your browser, and register your DEN identity. Your keys never leave this device in plaintext. Recovery is via your emergency wallet — set one up here."
    />
  )
}
