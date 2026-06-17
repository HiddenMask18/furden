import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '@/components/Placeholder'

// `/studio/keys` — key rotation (v1.x stub). Client-driven re-encryption per tier, then new
// blobs for all registered wallets (PROTOCOL.md "Key rotation"). Resumable.
export const Route = createFileRoute('/studio/keys')({
  component: Keys,
})

function Keys() {
  return (
    <Placeholder
      title="Key rotation"
      blurb="Rotate your master secret and re-encrypt your content. Coming in v1.x."
    />
  )
}
