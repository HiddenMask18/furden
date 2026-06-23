/**
 * Upload pipeline store — furden-architecture.md §4 / §8.
 *
 * Survives component unmounts across the three posting phases (encrypt → upload → register).
 * One post = one envelope = one blob, so the singular encryptedBlob/fingerprint pair is the
 * whole pipeline state — no per-file bookkeeping.
 */
import { create } from 'zustand'

export type PipelinePhase =
  | 'idle'
  | 'encrypting'
  | 'uploading'
  | 'registering'
  | 'done'
  | 'error'

export type PipelineError = { phase: PipelinePhase; message: string }

type PipelineState = {
  phase: PipelinePhase
  encryptedBlob: Uint8Array | null
  fingerprint: string | null
  tierId: number | null // 0 = public post (reserved)
  // The per-post random key for a PUBLIC post — kept so the visibility step (and a retry of it)
  // can publish it after the fingerprint is known. Null for paywalled posts (key is re-derivable
  // from the master secret), and cleared with the rest on completion/abandon.
  contentKey: Uint8Array | null
  error: PipelineError | null
  startEncryption: (tierId: number) => void
  setEncrypted: (blob: Uint8Array, contentKey?: Uint8Array | null) => void
  setFingerprint: (fp: string) => void
  setPhase: (phase: PipelinePhase) => void
  setError: (err: PipelineError) => void
  clear: () => void
}

export const usePipelineStore = create<PipelineState>((set) => ({
  phase: 'idle',
  encryptedBlob: null,
  fingerprint: null,
  tierId: null,
  contentKey: null,
  error: null,
  startEncryption: (tierId) => set({ phase: 'encrypting', tierId, error: null }),
  setEncrypted: (encryptedBlob, contentKey = null) =>
    set({ encryptedBlob, contentKey, phase: 'uploading' }),
  setFingerprint: (fingerprint) => set({ fingerprint, phase: 'registering' }),
  setPhase: (phase) => set({ phase }),
  setError: (error) => set({ error, phase: 'error' }),
  clear: () =>
    set({
      phase: 'idle',
      encryptedBlob: null,
      fingerprint: null,
      tierId: null,
      contentKey: null,
      error: null,
    }),
}))
