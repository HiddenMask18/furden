import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '@/components/Placeholder'

export const Route = createFileRoute('/about')({
  component: About,
})

function About() {
  return (
    <Placeholder
      title="What is DEN"
      blurb="A protocol for end-to-end encrypted content subscription. Hosters store only ciphertext. Creators hold their own keys. Subscribers pay directly on-chain and are the only ones who can read the plaintext."
    />
  )
}
