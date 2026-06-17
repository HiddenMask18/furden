import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '@/components/Placeholder'

// `/connect` — wallet connection entry. Stores `from` and redirects back after connection (§6).
// The connection modal (Radix Dialog over wagmi useConnect) is built here.
export const Route = createFileRoute('/connect')({
  validateSearch: (search: Record<string, unknown>): { from?: string } => ({
    from: typeof search.from === 'string' ? search.from : undefined,
  }),
  component: Connect,
})

function Connect() {
  const { from } = Route.useSearch()
  return (
    <Placeholder
      title="Connect your wallet"
      blurb="Your wallet is your key. Connect to sign in to your DEN session. Wallet connection is requested only at the point you act — never to browse a public profile."
    >
      {from && <p className="mono">Return to: {from}</p>}
    </Placeholder>
  )
}
