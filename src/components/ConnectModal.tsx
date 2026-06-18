import { useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useAccount, useConnect } from 'wagmi'
import type { Connector } from 'wagmi'
import styles from './ConnectModal.module.css'

/**
 * Wallet connection modal — furden-architecture.md §3 ("no RainbowKit/Web3Modal: built directly
 * on wagmi's useConnect using Radix Dialog"). Controlled component, reusable at every point a
 * connection is requested (the /connect route, onboarding step 1, the subscribe flow). It only
 * establishes the wallet connection; the challenge/verify sign-in is driven by SessionBridge's
 * page-load/connect effect (§5), so this component never touches the session store.
 */
type ConnectModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Fired once a wallet connection is established. Callers redirect / advance from here. */
  onConnected?: () => void
}

// Plain-language one-liner per connector. Keyed by wagmi connector id; unknown ids show no subtitle.
function subtitle(connector: Connector): string | undefined {
  switch (connector.id) {
    case 'injected':
      return 'Browser extension — MetaMask, Rabby, Brave'
    case 'coinbaseWalletSDK':
      return 'Coinbase Wallet app or extension'
    case 'walletConnect':
      return 'Scan with a mobile wallet'
    default:
      return undefined
  }
}

function isUserRejection(error: { name?: string; message: string }): boolean {
  return error.name === 'UserRejectedRequestError' || /rejected|denied/i.test(error.message)
}

export function ConnectModal({ open, onOpenChange, onConnected }: ConnectModalProps) {
  const { connectors, connect, isPending, variables, error, reset } = useConnect()
  const { status } = useAccount()

  // Once the wallet reports connected, hand off to the caller (redirect / advance). We do NOT
  // also close here — manual close (cancel) is a distinct path the caller treats differently.
  useEffect(() => {
    if (open && status === 'connected') onConnected?.()
  }, [open, status, onConnected])

  // Clear any stale connect error each time the modal is reopened.
  useEffect(() => {
    if (open) reset()
  }, [open, reset])

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.content}>
          <Dialog.Title className={styles.title}>Connect your wallet</Dialog.Title>
          <Dialog.Description className={styles.blurb}>
            Your wallet is your key. Connecting signs you in to your DEN session — no password, no
            email, no reset.
          </Dialog.Description>

          <ul className={styles.list}>
            {connectors.map((connector) => {
              const pending = isPending && variables?.connector === connector
              const sub = subtitle(connector)
              return (
                <li key={connector.uid}>
                  <button
                    type="button"
                    className={styles.option}
                    onClick={() => connect({ connector })}
                    disabled={isPending}
                  >
                    <span className={styles.optionName}>{connector.name}</span>
                    {sub && <span className={styles.optionSub}>{sub}</span>}
                    {pending && <span className={styles.optionState}>Connecting…</span>}
                  </button>
                </li>
              )
            })}
          </ul>

          {error && (
            <p className={styles.error} role="alert">
              {isUserRejection(error) ? 'Connection cancelled.' : error.message}
            </p>
          )}

          <Dialog.Close className={styles.close} aria-label="Close">
            ×
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
