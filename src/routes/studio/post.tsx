import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '@/components/Placeholder'

// `/studio/post` — composer. buildEnvelope(text, images) → encrypt → upload → register (§8).
// Max 10 images per post (composer policy). Size check: envelopeSize + 28 ≤ post_size_limit.
export const Route = createFileRoute('/studio/post')({
  component: NewPost,
})

function NewPost() {
  return (
    <Placeholder
      title="New post"
      blurb="Write a post, attach up to 10 images, choose a tier or post publicly. Everything is encrypted in your browser before it leaves this device."
    />
  )
}
