/**
 * Subscriber decryption pipeline — furden-architecture.md §8 ("Decryption pipeline").
 *
 * Download ciphertext → AES-256-GCM decrypt (the 12-byte nonce is prepended) → parse the post
 * envelope. A wrong key and malformed framing are indistinguishable to the viewer: both throw and
 * surface the same "content could not be decrypted" card (the caller decides how to render it).
 * Public content downloads without auth; paywalled content requires the session bearer.
 */
import { content } from './api'
import { decryptContent } from './crypto'
import { parseEnvelope, type Envelope } from './envelope'

export async function decryptPost(
  fingerprint: string,
  key: Uint8Array,
  opts: { authed?: boolean; baseUrl?: string } = {},
): Promise<Envelope> {
  const ciphertext = opts.authed
    ? await content.download(fingerprint, opts.baseUrl)
    : await content.downloadPublic(fingerprint, opts.baseUrl)
  const plaintext = await decryptContent(key, ciphertext)
  return parseEnvelope(plaintext)
}
