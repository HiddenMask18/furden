/**
 * Environment surface — furden-architecture.md §2.
 * Every value the app reads from import.meta.env is parsed and validated here exactly once.
 */

function required(name: keyof ImportMetaEnv): string {
  const value = import.meta.env[name]
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    )
  }
  return value
}

const chainId = Number(required('VITE_CHAIN_ID'))
if (![8453, 84532, 31337].includes(chainId)) {
  throw new Error(
    `VITE_CHAIN_ID must be 8453 (Base), 84532 (Base Sepolia), or 31337 (Anvil); got ${chainId}.`,
  )
}

// No trailing slash — used as the base for all instance API calls.
const instanceUrl = required('VITE_INSTANCE_URL').replace(/\/+$/, '')

function instanceName(): string {
  const explicit = import.meta.env.VITE_INSTANCE_NAME
  if (explicit) return explicit
  // Fall back to the host portion of the instance URL so the label is never blank.
  try {
    return new URL(instanceUrl).host
  } catch {
    return instanceUrl
  }
}

export const env = {
  chainId,
  instanceUrl,
  instanceName: instanceName(),
  walletConnectProjectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || undefined,
  blockExplorerOverride: import.meta.env.VITE_BLOCK_EXPLORER_URL || undefined,
  isDev: chainId === 31337,
} as const
