/**
 * Creator onboarding orchestration — PROTOCOL.md "Creator onboarding" (steps 1–7),
 * furden-architecture.md Flow 2. Each exported function is one resumable stage that the
 * /onboard wizard composes. Chain ops go through wagmi/actions + wagmiConfig (the lib/price.ts
 * pattern); signature-based ops take the hook's signMessageAsync (the lib/auth.ts pattern), so
 * this module stays free of React/wagmi hook types.
 */
import type { Address } from 'viem'
import { readContract, writeContract, waitForTransactionReceipt } from 'wagmi/actions'
import { wagmiConfig } from './wagmi'
import { creator as creatorApi } from './api'
import {
  encryptBlob,
  generateMasterSecret,
  recoverWalletPubKey,
  keyToHex,
  keyFromHex,
} from './crypto'
import { identityRegistryAbi, identityImplAbi } from './abis'
import { getContracts } from './chain'
import { env } from './env'

type SignMessage = (args: { message: string }) => Promise<`0x${string}`>

const contracts = () => getContracts(env.chainId)

/** Step 1 read — does this wallet already hold a registered DEN identity proxy? */
export async function isWalletRegistered(wallet: Address): Promise<boolean> {
  return readContract(wagmiConfig, {
    address: contracts().identityRegistry,
    abi: identityRegistryAbi,
    functionName: 'isRegistered',
    args: [wallet],
  })
}

/**
 * Step 1 write — deploy the identity proxy. One-time and permanent: the proxy address is the
 * creator's identity on DEN. Resolves once the transaction is mined.
 */
export async function registerIdentity(): Promise<void> {
  const hash = await writeContract(wagmiConfig, {
    address: contracts().identityRegistry,
    abi: identityRegistryAbi,
    functionName: 'register',
  })
  await waitForTransactionReceipt(wagmiConfig, { hash })
}

/**
 * Steps 3–6 — generate the master secret, encrypt it to the instance (operational blob) and to
 * the wallet (portability blob), and upload both. Requires an active session: the api client
 * reads the bearer token from the session store. Returns the master secret for the caller to put
 * in the crypto store.
 *
 * The emergency portability blob is omitted here — registering an emergency wallet is a separate,
 * later Settings action performed with that other wallet connected (PROTOCOL.md step 5 note).
 */
export async function provisionCreatorKeys(signMessageAsync: SignMessage): Promise<Uint8Array> {
  const { pubKey } = await creatorApi.blobPubkey()
  const masterSecret = generateMasterSecret()

  // Operational blob — encrypted to the instance's per-creator pubkey (step 3).
  const operationalBlob = await encryptBlob(masterSecret, keyFromHex(pubKey))

  // Portability blob — encrypted to the connected wallet's recovered secp256k1 pubkey. Writing it
  // needs only a signature; reading it back (recovery) needs the private key, which an injected
  // wallet never exposes — that's the v1.x recovery-side gap (PROTOCOL.md step 5 note).
  const walletPubKey = await recoverWalletPubKey(signMessageAsync)
  const portabilityBlob = await encryptBlob(masterSecret, walletPubKey)

  await creatorApi.putBlob({
    operationalBlob: keyToHex(operationalBlob),
    portabilityBlob: keyToHex(portabilityBlob),
  })
  return masterSecret
}

/** Step 7 read — the instance URL currently recorded on the proxy ('' when unset). */
export async function readInstanceUrl(proxy: Address): Promise<string> {
  return readContract(wagmiConfig, {
    address: proxy,
    abi: identityImplAbi,
    functionName: 'instanceURL',
  })
}

/**
 * Step 7 write — record the home instance URL on-chain using the instance's countersignature, so
 * clients can resolve this creator (§9). The instance signs only if its operator is registered;
 * a 503 from /creator/url-signature means that bootstrap step is still pending. The wizard treats
 * a failure here as non-fatal — the creator's keys are already live and the URL can be published
 * later from Settings.
 */
export async function setInstanceUrl(proxy: Address): Promise<void> {
  const { url, receivingInstanceProxy, instanceSig } = await creatorApi.urlSignature()
  const hash = await writeContract(wagmiConfig, {
    address: proxy,
    abi: identityImplAbi,
    functionName: 'updateInstanceURL',
    args: [url, receivingInstanceProxy, instanceSig as `0x${string}`],
  })
  await waitForTransactionReceipt(wagmiConfig, { hash })
}
