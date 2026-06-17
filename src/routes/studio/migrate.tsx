import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '@/components/Placeholder'

// `/studio/migrate` — instance migration (v1.x stub). Export → re-encrypt master secret to the
// new instance → import → upload blob → update on-chain instance URL (PROTOCOL.md "Migration").
// In-browser portability-blob decryption needs a key injected wallets don't expose (v1.x).
export const Route = createFileRoute('/studio/migrate')({
  component: Migrate,
})

function Migrate() {
  return (
    <Placeholder
      title="Migrate instance"
      blurb="Move your studio to another DEN host. Your subscribers keep their access. Coming in v1.x."
    />
  )
}
