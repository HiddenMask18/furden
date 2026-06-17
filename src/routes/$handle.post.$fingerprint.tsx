import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '@/components/Placeholder'

// `/$handle/post/$fingerprint` — post permalink. One post = one fingerprint = stable identity.
// Same access rules as the profile: public posts render for anyone; paywalled posts render
// locked until a key is held. "Copy link" emits den://$handle/post/$fingerprint (den-spec §6.4),
// never an instance URL.
export const Route = createFileRoute('/$handle/post/$fingerprint')({
  component: PostPermalink,
})

function PostPermalink() {
  const { handle, fingerprint } = Route.useParams()
  return (
    <Placeholder title="Post" blurb="A single post, addressed by its content fingerprint.">
      <p className="mono">den://{handle}/post/{fingerprint}</p>
    </Placeholder>
  )
}
