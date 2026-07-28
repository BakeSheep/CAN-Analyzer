import { detectBitrate } from '../../src/core/bitrateDetector'
import { quantize } from '../../src/core/quantizer'
import type { Capture } from '../../src/core/types'
import {
  makeStuffedLikeBits,
  makeSyntheticCapture,
} from '../fixtures/makeCapture'

function detect(capture: Capture, options?: { customBitrateBps?: number }) {
  const quantized = quantize(capture)
  return detectBitrate(quantized, capture.metadata.sampleRateHz, options)
}

describe('detectBitrate', () => {
  const bits = makeStuffedLikeBits(160)

  it.each([
    [125_000, 10_000_000],
    [125_000, 50_000_000],
    [250_000, 10_000_000],
    [250_000, 50_000_000],
    [500_000, 25_000_000],
    [500_000, 50_000_000],
    [1_000_000, 20_000_000],
    [1_000_000, 50_000_000],
  ])('ranks %d bit/s first at %d samples/s', (bitrateBps, sampleRateHz) => {
    const capture = makeSyntheticCapture({ bits, bitrateBps, sampleRateHz })
    const result = detect(capture)
    expect(result.candidates[0]?.bitrateBps).toBe(bitrateBps)
    expect(result.reliable).toBe(true)
  })

  it('matches the supplied-file profile: 50 MHz, ~100 samples/bit → 500 kbit/s', () => {
    const capture = makeSyntheticCapture({
      bits,
      bitrateBps: 500_000,
      sampleRateHz: 50_000_000,
      noiseMv: 60,
      seed: 3,
    })
    const result = detect(capture)
    const best = result.candidates[0]
    expect(best.bitrateBps).toBe(500_000)
    expect(best.samplesPerBit).toBeCloseTo(100, 5)
    expect(result.reliable).toBe(true)
  })

  it('tolerates edge jitter', () => {
    const capture = makeSyntheticCapture({
      bits,
      bitrateBps: 250_000,
      sampleRateHz: 10_000_000,
      jitterSamples: 3,
      seed: 11,
    })
    const result = detect(capture)
    expect(result.candidates[0]?.bitrateBps).toBe(250_000)
    expect(result.reliable).toBe(true)
  })

  it('handles long identical runs (idle-heavy capture)', () => {
    const capture = makeSyntheticCapture({
      bits,
      bitrateBps: 500_000,
      sampleRateHz: 50_000_000,
      idleBitsBefore: 200,
      idleBitsAfter: 200,
    })
    const result = detect(capture)
    expect(result.candidates[0]?.bitrateBps).toBe(500_000)
  })

  it('reports invertPolarity when the quantized idle level is dominant', () => {
    const capture = makeSyntheticCapture({
      bits,
      bitrateBps: 500_000,
      sampleRateHz: 50_000_000,
    })
    // Force the wrong polarity mapping: idle becomes logic 0.
    const wrong = quantize(capture, { dominantIsLow: false })
    const result = detectBitrate(wrong, capture.metadata.sampleRateHz)
    expect(result.candidates[0]?.bitrateBps).toBe(500_000)
    expect(result.candidates[0]?.invertPolarity).toBe(true)

    const right = quantize(capture, { dominantIsLow: true })
    const ok = detectBitrate(right, capture.metadata.sampleRateHz)
    expect(ok.candidates[0]?.invertPolarity).toBe(false)
  })

  it('retains both polarity variants as ranked candidates', () => {
    const capture = makeSyntheticCapture({
      bits,
      bitrateBps: 500_000,
      sampleRateHz: 50_000_000,
    })
    const result = detect(capture)
    const variants = result.candidates.filter(
      (c) => c.bitrateBps === 500_000,
    )
    expect(variants).toHaveLength(2)
    expect(new Set(variants.map((c) => c.invertPolarity)).size).toBe(2)
    // The disfavored polarity is retained but ranked strictly lower.
    const [first, second] = variants
    expect(first.confidence).toBeGreaterThan(second.confidence)
  })

  it('flags ambiguous polarity when idle runs are too short', () => {
    // Only 3 idle bits at either end; content runs are all ≤5 bits, so no
    // run reaches the 7-bit idle threshold → no polarity evidence.
    const capture = makeSyntheticCapture({
      bits,
      bitrateBps: 500_000,
      sampleRateHz: 50_000_000,
      idleBitsBefore: 3,
      idleBitsAfter: 3,
    })
    const result = detect(capture)
    expect(result.candidates[0]?.polarityEvidence).toBeCloseTo(0.5, 5)
    expect(result.warnings.join(' ')).toMatch(/极性/)
  })

  it('refuses to claim success with insufficient transitions', () => {
    const capture = makeSyntheticCapture({
      bits: [0, 0, 0, 0, 0, 0],
      bitrateBps: 500_000,
      sampleRateHz: 50_000_000,
    })
    const result = detect(capture)
    expect(result.reliable).toBe(false)
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings.join(' ')).toMatch(/手动|跳变/)
  })

  it('rejects rates with fewer than 4 samples per bit', () => {
    const capture = makeSyntheticCapture({
      bits,
      bitrateBps: 500_000,
      sampleRateHz: 2_000_000, // 1 Mbit/s would give only 2 samples/bit
    })
    const result = detect(capture)
    expect(
      result.candidates.every((c) => c.bitrateBps !== 1_000_000),
    ).toBe(true)
  })

  it('scores a manual custom bitrate alongside common rates', () => {
    const custom = 640_000
    const capture = makeSyntheticCapture({
      bits,
      bitrateBps: custom,
      sampleRateHz: 32_000_000,
    })
    const result = detect(capture, { customBitrateBps: custom })
    expect(result.candidates[0]?.bitrateBps).toBe(custom)
    expect(result.reliable).toBe(true)
  })

  it('estimates bit-boundary phase and a 75% sampling point', () => {
    const capture = makeSyntheticCapture({
      bits,
      bitrateBps: 500_000,
      sampleRateHz: 50_000_000,
    })
    const result = detect(capture)
    const best = result.candidates[0]
    const spb = best.samplesPerBit
    // Edges land on exact bit boundaries → boundary phase near 0 (mod spb).
    const wrapped = Math.min(
      best.bitBoundaryOffsetSamples,
      spb - best.bitBoundaryOffsetSamples,
    )
    expect(wrapped).toBeLessThan(spb * 0.1)
    // The sampling point sits 75% of a bit period after the boundary.
    const gap =
      (best.samplePointOffsetSamples - best.bitBoundaryOffsetSamples + spb) %
      spb
    expect(gap).toBeCloseTo(0.75 * spb, 6)
  })
})
