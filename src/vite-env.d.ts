/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CHAIN_ID: string
  readonly VITE_INSTANCE_URL: string
  readonly VITE_INSTANCE_NAME?: string
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string
  readonly VITE_BLOCK_EXPLORER_URL?: string

  // Dev-only (chain 31337)
  readonly VITE_DEV_IDENTITY_REGISTRY_ADDRESS?: string
  readonly VITE_DEV_SUBSCRIPTION_ADDRESS?: string
  readonly VITE_DEV_CONTENT_REGISTRY_ADDRESS?: string
  readonly VITE_DEV_ACCESS_GRANT_ADDRESS?: string
  readonly VITE_DEV_GOVERNANCE_ADDRESS?: string
  readonly VITE_DEV_TRUST_TIER_ADDRESS?: string
  readonly VITE_DEV_REPORT_REGISTRY_ADDRESS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
