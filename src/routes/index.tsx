import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '@/components/Placeholder'

// `/` — static landing page (§ Appendix A "Static landing page"). No instance-backed discovery:
// the instance exposes no creator listing or trending query. Public, no auth required.
export const Route = createFileRoute('/')({
  component: Landing,
})

function Landing() {
  return (
    <Placeholder
      title="Your content is encrypted here, in your browser."
      blurb="DEN is a destination, not a discovery platform. Creators are found on the platforms they already use and link here. This is the reference client, furden."
    />
  )
}
