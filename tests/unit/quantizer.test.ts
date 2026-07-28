import { quantize } from '../../src/core/quantizer'
import type { Capture } from '../../src/core/types'

/** Deterministic PRNG so CI never flakes. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeCapture(samples: Float32Array, sampleRateHz = 50_000_000): Capture {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const v of samples) {
    if (v < min) min = v
    if (v > max) max = v
  }
  return {
    metadata: {
      sampleRateHz,
      unit: 'mV',
      sampleCount: samples.length,
      min,
      max,
    },
    samples,
  }
}

/**
 * Two noisy clusters shaped like the supplied capture: recessive idle near
 * 0 mV and dominant pulses near -2200 mV, 100 samples per bit.
 */
function makeBimodalCapture(seed = 1): Capture {
  const rng = mulberry32(seed)
  const bits = [1, 1, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1]
  const samplesPerBit = 100
  const samples = new Float32Array(bits.length * samplesPerBit)
  for (const [i, bit] of bits.entries()) {
    const base = bit === 1 ? 0 : -2200
    for (let s = 0; s < samplesPerBit; s += 1) {
      samples[i * samplesPerBit + s] = base + (rng() - 0.5) * 60
    }
  }
  return makeCapture(samples)
}

describe('quantize', () => {
  it('estimates the two levels close to the source clusters', () => {
    const result = quantize(makeBimodalCapture())
    expect(result.levels.lowLevel).toBeGreaterThan(-2300)
    expect(result.levels.lowLevel).toBeLessThan(-2100)
    expect(result.levels.highLevel).toBeGreaterThan(-100)
    expect(result.levels.highLevel).toBeLessThan(100)
    expect(result.levels.confidence).toBeGreaterThan(0.8)
    expect(result.warnings).toHaveLength(0)
  })

  it('defaults the threshold to the cluster midpoint', () => {
    const result = quantize(makeBimodalCapture())
    const midpoint = (result.levels.lowLevel + result.levels.highLevel) / 2
    expect(result.levels.threshold).toBeCloseTo(midpoint, 0)
    expect(result.applied.thresholdMv).toBeCloseTo(midpoint, 0)
  })

  it('produces transition runs, not one object per sample', () => {
    const capture = makeBimodalCapture()
    const result = quantize(capture)
    expect(result.transitions).toBeInstanceOf(Int32Array)
    expect(result.transitions[0]).toBe(0)
    // 20 bits with 8 level changes → exactly 9 runs, far below sampleCount.
    expect(result.transitions.length).toBe(9)
    expect(result.sampleCount).toBe(capture.metadata.sampleCount)
  })

  it('suppresses single-sample chatter through hysteresis', () => {
    // Clean low run with one excursion just past the threshold midpoint.
    const samples = new Float32Array(300)
    samples.fill(-2200, 0, 150)
    samples.fill(0, 150, 300)
    samples[70] = -1050 // above midpoint (-1100) but inside hysteresis band
    const result = quantize(makeCapture(samples), {
      thresholdMv: -1100,
      hysteresisMv: 200,
    })
    // Only the genuine transition at sample 150 must remain.
    expect(result.transitions.length).toBe(2)
    expect(result.transitions[1]).toBe(150)
  })

  it('supports both polarity selections', () => {
    const capture = makeBimodalCapture()
    const dominantLow = quantize(capture, { dominantIsLow: true })
    const dominantHigh = quantize(capture, { dominantIsLow: false })
    // Same transition positions, inverted logic levels.
    expect(Array.from(dominantLow.transitions)).toEqual(
      Array.from(dominantHigh.transitions),
    )
    expect(dominantLow.initialLevel).not.toBe(dominantHigh.initialLevel)
    // Idle (0 mV) is recessive=1 when the dominant level is the low cluster.
    expect(dominantLow.initialLevel).toBe(1)
  })

  it('defaults polarity so the minority cluster is dominant', () => {
    // Mostly idle at 0 mV, brief dominant dips to -2200 mV.
    const result = quantize(makeBimodalCapture())
    expect(result.applied.dominantIsLow).toBe(true)
    expect(result.initialLevel).toBe(1)
  })

  it('flags a flat capture with an actionable low-confidence warning', () => {
    const samples = new Float32Array(2000).fill(-3)
    const result = quantize(makeCapture(samples))
    expect(result.levels.confidence).toBeLessThan(0.5)
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings.join(' ')).toMatch(/阈值|置信/)
  })

  it('flags non-bimodal noise as low confidence', () => {
    const rng = mulberry32(7)
    const samples = new Float32Array(4000)
    for (let i = 0; i < samples.length; i += 1) samples[i] = rng() * 1000
    const result = quantize(makeCapture(samples))
    expect(result.levels.confidence).toBeLessThan(0.5)
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('preserves manual overrides in the applied settings', () => {
    const result = quantize(makeBimodalCapture(), {
      thresholdMv: -900,
      hysteresisMv: 120,
      dominantIsLow: false,
    })
    expect(result.applied).toEqual({
      thresholdMv: -900,
      hysteresisMv: 120,
      dominantIsLow: false,
    })
  })
})
