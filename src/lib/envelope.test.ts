import { describe, it, expect } from 'vitest'
import { buildEnvelope, parseEnvelope, EnvelopeError, MAGIC, VERSION, type EnvelopeImage } from './envelope'

function img(byte: number, len: number, type = 'image/png', w = 100, h = 80): EnvelopeImage {
  return { bytes: new Uint8Array(len).fill(byte), type, w, h }
}

describe('envelope round-trip', () => {
  it('text-only post', () => {
    const out = parseEnvelope(buildEnvelope('hello world', []))
    expect(out.text).toBe('hello world')
    expect(out.images).toHaveLength(0)
  })

  it('empty text-only post', () => {
    const out = parseEnvelope(buildEnvelope('', []))
    expect(out.text).toBe('')
    expect(out.images).toHaveLength(0)
  })

  it('image-only post', () => {
    const out = parseEnvelope(buildEnvelope('', [img(0xaa, 32)]))
    expect(out.text).toBe('')
    expect(out.images).toHaveLength(1)
    expect(out.images[0].bytes).toEqual(new Uint8Array(32).fill(0xaa))
    expect(out.images[0].type).toBe('image/png')
    expect(out.images[0].w).toBe(100)
    expect(out.images[0].h).toBe(80)
  })

  it('text + multiple images preserves order and bytes', () => {
    const images = [img(0x01, 10, 'image/jpeg', 4, 4), img(0x02, 20, 'image/webp', 8, 8), img(0x03, 5)]
    const out = parseEnvelope(buildEnvelope('caption', images))
    expect(out.text).toBe('caption')
    expect(out.images.map((i) => i.bytes.length)).toEqual([10, 20, 5])
    expect(out.images[0].bytes[0]).toBe(0x01)
    expect(out.images[1].type).toBe('image/webp')
    expect(out.images[2].bytes[4]).toBe(0x03)
  })

  it('preserves unicode text', () => {
    const out = parseEnvelope(buildEnvelope('🦊 furry — café', []))
    expect(out.text).toBe('🦊 furry — café')
  })
})

describe('envelope framing', () => {
  it('writes the magic and version', () => {
    const env = buildEnvelope('x', [])
    expect(String.fromCharCode(env[0], env[1], env[2], env[3])).toBe(MAGIC)
    expect(env[4]).toBe(VERSION)
  })
})

describe('envelope validation', () => {
  it('rejects a short buffer', () => {
    expect(() => parseEnvelope(new Uint8Array(4))).toThrow(EnvelopeError)
  })

  it('rejects bad magic', () => {
    const env = buildEnvelope('x', [])
    env[0] = 0x00
    expect(() => parseEnvelope(env)).toThrow(/magic/i)
  })

  it('rejects an unknown version', () => {
    const env = buildEnvelope('x', [])
    env[4] = 0x02
    expect(() => parseEnvelope(env)).toThrow(/version/i)
  })

  it('rejects a byte-count mismatch (truncated payload)', () => {
    const env = buildEnvelope('x', [img(0x07, 16)])
    expect(() => parseEnvelope(env.subarray(0, env.length - 1))).toThrow(EnvelopeError)
  })

  it('rejects a header length that overruns the buffer', () => {
    const env = buildEnvelope('x', [])
    const view = new DataView(env.buffer)
    view.setUint32(5, 0xffff, false)
    expect(() => parseEnvelope(env)).toThrow(EnvelopeError)
  })
})
