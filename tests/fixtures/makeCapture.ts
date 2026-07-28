import type { Capture } from '../../src/core/types'

/** Deterministic PRNG (mulberry32) so fixtures never flake in CI. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface SyntheticCaptureOptions {
  /** Logical CAN bits, 1 = recessive, 0 = dominant. */
  bits: ReadonlyArray<0 | 1>
  bitrateBps: number
  sampleRateHz: number
  /** Recessive-level voltage in mV. Default 0 (like the supplied file). */
  recessiveMv?: number
  /** Dominant-level voltage in mV. Default -2200 (like the supplied file). */
  dominantMv?: number
  /** Swap the voltage mapping so dominant becomes the HIGH voltage. */
  invert?: boolean
  /** Uniform noise peak-to-peak amplitude in mV. Default 0. */
  noiseMv?: number
  /** Maximum edge jitter in samples (uniform, ±). Default 0. */
  jitterSamples?: number
  /** Recessive idle bits prepended/appended. Defaults 12 / 12. */
  idleBitsBefore?: number
  idleBitsAfter?: number
  seed?: number
}

/**
 * Render a logical bit stream into an oversampled analog `Capture` with
 * deterministic noise and edge jitter.
 */
export function makeSyntheticCapture(
  options: SyntheticCaptureOptions,
): Capture {
  const {
    bits,
    bitrateBps,
    sampleRateHz,
    recessiveMv = 0,
    dominantMv = -2200,
    invert = false,
    noiseMv = 0,
    jitterSamples = 0,
    idleBitsBefore = 12,
    idleBitsAfter = 12,
    seed = 42,
  } = options
  const rng = mulberry32(seed)
  const spb = sampleRateHz / bitrateBps

  const stream: Array<0 | 1> = [
    ...Array.from({ length: idleBitsBefore }, () => 1 as const),
    ...bits,
    ...Array.from({ length: idleBitsAfter }, () => 1 as const),
  ]

  // Exact bit boundaries with optional deterministic jitter on real edges.
  const boundaries = new Array<number>(stream.length + 1)
  for (let k = 0; k <= stream.length; k += 1) {
    let pos = Math.round(k * spb)
    const isEdge =
      k > 0 && k < stream.length && stream[k - 1] !== stream[k]
    if (isEdge && jitterSamples > 0) {
      pos += Math.round((rng() - 0.5) * 2 * jitterSamples)
    }
    boundaries[k] = pos
  }

  const totalSamples = boundaries[stream.length]
  const samples = new Float32Array(totalSamples)
  const recessive = invert ? dominantMv : recessiveMv
  const dominant = invert ? recessiveMv : dominantMv
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (let k = 0; k < stream.length; k += 1) {
    const level = stream[k] === 1 ? recessive : dominant
    for (let i = boundaries[k]; i < boundaries[k + 1]; i += 1) {
      const v = level + (rng() - 0.5) * noiseMv
      samples[i] = v
      if (v < min) min = v
      if (v > max) max = v
    }
  }

  return {
    metadata: {
      sampleRateHz,
      unit: 'mV',
      probe: 'X1',
      sampleCount: totalSamples,
      min,
      max,
    },
    samples,
  }
}

/**
 * Deterministic pseudo-CAN payload bits: run lengths of 1-5 like a stuffed
 * CAN stream, starting and ending dominant so edges are plentiful.
 */
export function makeStuffedLikeBits(count: number, seed = 7): Array<0 | 1> {
  const rng = mulberry32(seed)
  const bits: Array<0 | 1> = []
  let level: 0 | 1 = 0
  while (bits.length < count) {
    const run = 1 + Math.floor(rng() * 5)
    for (let i = 0; i < run && bits.length < count; i += 1) bits.push(level)
    level = level === 0 ? 1 : 0
  }
  return bits
}
