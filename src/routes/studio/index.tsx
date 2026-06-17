import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '@/components/Placeholder'

export const Route = createFileRoute('/studio/')({
  component: Dashboard,
})

function Dashboard() {
  return (
    <Placeholder
      title="Dashboard"
      blurb="Your studio overview: recent posts, subscriber counts, and escrow surplus."
    />
  )
}
