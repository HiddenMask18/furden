/**
 * DEN instance API client — PROTOCOL.md (full API surface).
 *
 * Every per-creator call SHOULD ultimately be routed to that creator's chain-resolved instance
 * URL (§9). In single-instance v1 that resolves to env.instanceUrl for on-instance creators;
 * the `baseUrl` argument exists so multi-instance later is "stop asserting", not a rewrite.
 *
 * Auth: the bearer token is read from the session store at call time. Any 401 clears the
 * session (§5 step 4) so the UI surfaces the reconnect banner.
 */
import type { Address } from 'viem'
import { env } from './env'
import { useSessionStore } from '@/stores/session'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

type RequestOpts = {
  method?: string
  body?: BodyInit | object | null
  headers?: Record<string, string>
  auth?: boolean
  baseUrl?: string
  raw?: boolean // resolve to Uint8Array instead of JSON (ciphertext download)
}

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const { method = 'GET', auth = false, baseUrl = env.instanceUrl, raw = false } = opts
  const headers: Record<string, string> = { ...opts.headers }

  let body = opts.body as BodyInit | null | undefined
  if (body != null && !(body instanceof Uint8Array) && typeof body === 'object' && !(body instanceof Blob)) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(body)
  }

  if (auth) {
    const token = useSessionStore.getState().token
    if (!token) throw new ApiError(401, 'No active session.')
    headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(`${baseUrl}${path}`, { method, headers, body })

  if (res.status === 401) {
    useSessionStore.getState().clearSession()
    throw new ApiError(401, 'Session ended.')
  }
  if (!res.ok) {
    let parsed: unknown
    try {
      parsed = await res.json()
    } catch {
      parsed = await res.text().catch(() => '')
    }
    throw new ApiError(res.status, `${method} ${path} → ${res.status}`, parsed)
  }

  if (raw) return new Uint8Array(await res.arrayBuffer()) as unknown as T
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

// ---- Auth -----------------------------------------------------------------
export const auth = {
  challenge: (wallet: Address) =>
    request<{ nonce: string }>(`/auth/challenge?wallet=${wallet}`),
  verify: (wallet: Address, nonce: string, signature: string) =>
    request<{ sessionToken: string; proxy: Address }>(`/auth/verify`, {
      method: 'POST',
      body: { wallet, nonce, signature },
    }),
}

// ---- Public profile -------------------------------------------------------
export type TierDef = { tierId: string; price: string; duration: string; token: Address }
export type PublicContent = {
  fingerprint: string
  tierId: string
  timestamp: number
  warnings: string[] | null
  contentKey: string
}
export type Profile = {
  proxy: Address
  handle: string | null
  bio: string | null
  tiers: TierDef[]
  publicContent: PublicContent[]
  contentWarnings: { fingerprint: string; tierId: string; warnings: string[] | null }[]
}

export const profile = {
  get: (proxy: Address, baseUrl?: string) =>
    request<Profile>(`/profile/${proxy}`, { baseUrl }),
}

// ---- Content (subscriber) -------------------------------------------------
export type ContentRef = {
  fingerprint: string
  tierId: string
  timestamp: number
  warnings: string[] | null
}

export const content = {
  byCreator: (proxy: Address, tierId: number, baseUrl?: string) =>
    request<{ content: ContentRef[]; nextCursor: string | null }>(
      `/content/by-creator/${proxy}?tierId=${tierId}`,
      { auth: true, baseUrl },
    ),
  download: (fingerprint: string, baseUrl?: string) =>
    request<Uint8Array>(`/content/${fingerprint}`, { auth: true, raw: true, baseUrl }),
  downloadPublic: (fingerprint: string, baseUrl?: string) =>
    request<Uint8Array>(`/content/${fingerprint}`, { raw: true, baseUrl }),
}

// ---- Access keys ----------------------------------------------------------
export const access = {
  subscriptionKey: (creatorProxy: Address, tierId: number, baseUrl?: string) =>
    request<{ keys: Record<string, string> }>(`/access/key`, {
      method: 'POST',
      auth: true,
      baseUrl,
      body: { type: 'subscription', creatorProxy, tierId: String(tierId) },
    }),
}

// ---- Creator --------------------------------------------------------------
export const creator = {
  blobPubkey: () => request<{ pubKey: string }>(`/creator/blob-pubkey`, { auth: true }),
  blobExists: () => request<{ exists: boolean }>(`/creator/blob`, { auth: true }),
  putBlob: (body: { operationalBlob: string; portabilityBlob: string; emergencyPortabilityBlob?: string }) =>
    request<{ stored: boolean }>(`/creator/blob`, { method: 'PUT', auth: true, body }),
  setProfile: (bio: string | null) =>
    request<{ stored: boolean }>(`/creator/profile`, { method: 'PUT', auth: true, body: { bio } }),
  uploadContent: (ciphertext: Uint8Array, tierId: number, warnings?: string[]) => {
    const headers: Record<string, string> = { 'X-Tier-Id': String(tierId), 'Content-Type': 'application/octet-stream' }
    if (warnings && warnings.length) headers['X-Warnings'] = JSON.stringify(warnings)
    return request<{ fingerprint: string }>(`/creator/content`, { method: 'POST', auth: true, body: ciphertext, headers })
  },
  putGrant: (tierId: string, paths: string[], signature: string, version: number) =>
    request<{ stored: boolean }>(`/creator/grant`, { method: 'POST', auth: true, body: { tierId, paths, signature, version } }),
  getGrant: (tierId: number) =>
    request<{ tierId: string; paths: string[]; version: number }>(`/creator/grant/${tierId}`, { auth: true }),
  urlSignature: () =>
    request<{ url: string; receivingInstanceProxy: Address; instanceSig: string; nonce: string }>(`/creator/url-signature`, { auth: true }),
  setVisibility: (fingerprint: string, body: { isPublic: true; contentKey: string } | { isPublic: false }) =>
    request<{ stored: boolean }>(`/creator/content/${fingerprint}/visibility`, { method: 'PUT', auth: true, body }),
}

// ---- Governance -----------------------------------------------------------
export const governance = {
  params: () => request<Record<string, unknown>>(`/governance/params`),
}
