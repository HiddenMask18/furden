import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '@/components/Placeholder'

// `/studio/content` — content library. Visibility toggles are re-encryption events (§8): going
// public→private does not un-publish what was already public; copy must say so honestly.
export const Route = createFileRoute('/studio/content')({
  component: ContentLibrary,
})

function ContentLibrary() {
  return (
    <Placeholder
      title="Content library"
      blurb="Everything you've published, by tier. Change a post's visibility, or archive it."
    />
  )
}
