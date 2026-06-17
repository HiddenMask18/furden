/**
 * Post envelope codec — PROTOCOL.md §"Post envelope (content plaintext format)".
 *
 * One post (body text + zero or more images) serialises into a single plaintext envelope,
 * encrypted as ONE blob with ONE fingerprint. Pure functions — no chain, no network, no
 * crypto — so they are unit-testable in isolation (see envelope.test.ts).
 *
 * Byte layout:
 *   0           4          magic: ASCII "DENP"
 *   4           1          version: 0x01
 *   5           4          headerLen: uint32, big-endian
 *   9           headerLen  header: UTF-8 JSON
 *   9+headerLen ...        image payloads: raw bytes, concatenated in header order
 */

export const MAGIC = 'DENP'
export const VERSION = 0x01

/** Composer policy (NOT a protocol rule): maximum images per post. */
export const MAX_IMAGES = 10

export type EnvelopeImage = {
  bytes: Uint8Array
  type: string // MIME, e.g. "image/png"
  w: number // pixel width, captured at compose time
  h: number // pixel height
}

export type Envelope = {
  text: string
  images: EnvelopeImage[]
}

type HeaderImage = { len: number; type: string; w: number; h: number }
type Header = { text: string; images: HeaderImage[] }

export class EnvelopeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EnvelopeError'
  }
}

const te = new TextEncoder()
const td = new TextDecoder('utf-8', { fatal: true })

/** Serialise a post into the plaintext envelope (pre-encryption bytes). */
export function buildEnvelope(text: string, images: EnvelopeImage[]): Uint8Array {
  const header: Header = {
    text,
    images: images.map((img) => ({
      len: img.bytes.length,
      type: img.type,
      w: img.w,
      h: img.h,
    })),
  }
  const headerBytes = te.encode(JSON.stringify(header))
  const imagesTotal = images.reduce((n, img) => n + img.bytes.length, 0)
  const total = 9 + headerBytes.length + imagesTotal

  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)

  out.set(te.encode(MAGIC), 0) // 0..4
  out[4] = VERSION // 4
  view.setUint32(5, headerBytes.length, false) // 5..9, big-endian
  out.set(headerBytes, 9) // 9..9+headerLen

  let offset = 9 + headerBytes.length
  for (const img of images) {
    out.set(img.bytes, offset)
    offset += img.bytes.length
  }
  return out
}

/**
 * Parse and validate a decrypted plaintext envelope. Any validation failure throws
 * EnvelopeError — callers render the same "content could not be decrypted" error card as a
 * decryption failure (malformed framing and a wrong key are indistinguishable to the viewer).
 */
export function parseEnvelope(plaintext: Uint8Array): Envelope {
  if (plaintext.length < 9) {
    throw new EnvelopeError('Envelope too short for header.')
  }

  const magic = String.fromCharCode(plaintext[0], plaintext[1], plaintext[2], plaintext[3])
  if (magic !== MAGIC) {
    throw new EnvelopeError(`Bad magic: expected ${MAGIC}.`)
  }
  if (plaintext[4] !== VERSION) {
    // Unknown versions are an error, not a guess.
    throw new EnvelopeError(`Unsupported envelope version 0x${plaintext[4].toString(16)}.`)
  }

  const view = new DataView(plaintext.buffer, plaintext.byteOffset, plaintext.byteLength)
  const headerLen = view.getUint32(5, false)
  const headerEnd = 9 + headerLen
  if (headerEnd > plaintext.length) {
    throw new EnvelopeError('Header length exceeds envelope size.')
  }

  let header: Header
  try {
    header = JSON.parse(td.decode(plaintext.subarray(9, headerEnd))) as Header
  } catch {
    throw new EnvelopeError('Header is not valid UTF-8 JSON.')
  }
  if (typeof header.text !== 'string' || !Array.isArray(header.images)) {
    throw new EnvelopeError('Header shape is invalid.')
  }

  let declared = 0
  for (const img of header.images) {
    if (
      typeof img.len !== 'number' ||
      img.len < 0 ||
      typeof img.type !== 'string' ||
      typeof img.w !== 'number' ||
      typeof img.h !== 'number'
    ) {
      throw new EnvelopeError('Image manifest entry is invalid.')
    }
    declared += img.len
  }

  // The envelope must account for every byte.
  if (headerEnd + declared !== plaintext.length) {
    throw new EnvelopeError('Envelope byte count does not match the image manifest.')
  }

  const images: EnvelopeImage[] = []
  let offset = headerEnd
  for (const img of header.images) {
    images.push({
      bytes: plaintext.subarray(offset, offset + img.len),
      type: img.type,
      w: img.w,
      h: img.h,
    })
    offset += img.len
  }

  return { text: header.text, images }
}

/** Plaintext envelope size; AES-256-GCM adds exactly 28 bytes (12 nonce + 16 tag). */
export const GCM_OVERHEAD = 28
