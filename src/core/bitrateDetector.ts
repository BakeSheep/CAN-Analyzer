import type {
  BitrateCandidate,
  BitrateDetection,
  QuantizedSignal,
} from './types'

/** Common Classic CAN nominal rates, 10 kbit/s through 1 Mbit/s. */
export const COMMON_BITRATES = [
  10_000, 20_000, 33_333, 50_000, 83_333, 100_000, 125_000, 250_000, 500_000,
  800_000, 1_000_000,
] as const

/** Reject rates leaving fewer samples per bit than this. */
const MIN_SAMPLES_PER_BIT = 4
/** Edges needed before automatic detection may claim success. */
const MIN_EDGES = 8
/** Candidates below this confidence force manual selection. */
const CONFIDENCE_THRESHOLD = 0.5
/**
 * Runs at least this many bit periods long count as idle evidence: a valid
 * stuffed CAN stream never holds a level longer than 5 bits between SOF and
 * CRC, so ≥7 bits implies EOF/interframe idle, which must be recessive.
 */
const IDLE_RUN_BITS = 7

export interface BitrateDetectorOptions {
  /** Extra user-provided rate evaluated alongside the common rates. */
  customBitrateBps?: number
}

/**
 * Score candidate bitrates against the observed transition intervals.
 *
 * Each interval is compared with the nearest positive integer multiple of
 * the candidate bit period; normalized timing residuals, weak transition
 * counts, inconsistent edge phase, and missing single-bit intervals
 * (sub-harmonic candidates) are penalized.
 *
 * BOTH polarities are retained as separate ranked candidates. Idle-run
 * evidence only weights the ranking; the decoder makes the final call via
 * SOF/stuffing/CRC/EOF success, so a truncated or idle-poor capture cannot
 * lock in a wrong polarity with high confidence.
 */
export function detectBitrate(
  quantized: QuantizedSignal,
  sampleRateHz: number,
  options: BitrateDetectorOptions = {},
): BitrateDetection {
  const { transitions } = quantized
  const warnings: string[] = []

  // transitions[0] is the capture start, not a real edge.
  const edgeCount = Math.max(0, transitions.length - 1)
  const intervals: number[] = []
  for (let i = 2; i < transitions.length; i += 1) {
    intervals.push(transitions[i] - transitions[i - 1])
  }

  const rates = new Set<number>(COMMON_BITRATES)
  if (
    options.customBitrateBps !== undefined &&
    Number.isFinite(options.customBitrateBps) &&
    options.customBitrateBps > 0
  ) {
    rates.add(options.customBitrateBps)
  }

  const candidates: BitrateCandidate[] = []
  for (const bitrateBps of rates) {
    const samplesPerBit = sampleRateHz / bitrateBps
    if (samplesPerBit < MIN_SAMPLES_PER_BIT) continue
    if (intervals.length === 0) continue

    let residualSum = 0
    let singleBitCount = 0
    for (const interval of intervals) {
      const k = Math.max(1, Math.round(interval / samplesPerBit))
      residualSum += Math.abs(interval - k * samplesPerBit) / samplesPerBit
      if (k === 1) singleBitCount += 1
    }
    const meanResidual = residualSum / intervals.length
    const timingScore = Math.max(0, 1 - 4 * meanResidual)

    // Circular statistics of edge positions modulo the bit period.
    let sumCos = 0
    let sumSin = 0
    for (let i = 1; i < transitions.length; i += 1) {
      const angle =
        ((transitions[i] % samplesPerBit) / samplesPerBit) * 2 * Math.PI
      sumCos += Math.cos(angle)
      sumSin += Math.sin(angle)
    }
    const phaseR = edgeCount > 0
      ? Math.hypot(sumCos, sumSin) / edgeCount
      : 0
    let bitBoundaryOffsetSamples =
      (Math.atan2(sumSin, sumCos) / (2 * Math.PI)) * samplesPerBit
    if (bitBoundaryOffsetSamples < 0) bitBoundaryOffsetSamples += samplesPerBit
    const samplePointOffsetSamples =
      (bitBoundaryOffsetSamples + 0.75 * samplesPerBit) % samplesPerBit

    // Sub-harmonic candidates (double/quadruple rate) fit every interval
    // but never see single-bit intervals, which stuffing guarantees.
    const singleBitShare = singleBitCount / intervals.length
    const singleBitFactor = 0.4 + 0.6 * Math.min(1, singleBitShare * 4)
    const edgeFactor = Math.min(1, edgeCount / 16)
    const phaseFactor = 0.5 + 0.5 * phaseR
    const baseConfidence =
      timingScore * phaseFactor * edgeFactor * singleBitFactor

    // Idle evidence for this rate: share of idle-length run time spent at
    // logic 1 under the current (non-inverted) mapping. 0.5 = no evidence.
    const recessiveIdleShare = idleRecessiveShare(
      quantized,
      samplesPerBit * IDLE_RUN_BITS,
    )

    for (const invertPolarity of [false, true] as const) {
      const polarityEvidence = invertPolarity
        ? 1 - recessiveIdleShare
        : recessiveIdleShare
      const confidence = baseConfidence * (0.5 + 0.5 * polarityEvidence)
      candidates.push({
        bitrateBps,
        samplesPerBit,
        confidence,
        invertPolarity,
        polarityEvidence,
        bitBoundaryOffsetSamples,
        samplePointOffsetSamples,
        diagnostics:
          `spb=${samplesPerBit.toFixed(2)}, edges=${edgeCount}, ` +
          `meanResidual=${(meanResidual * 100).toFixed(1)}%, ` +
          `phaseR=${phaseR.toFixed(2)}, ` +
          `singleBitShare=${(singleBitShare * 100).toFixed(0)}%, ` +
          `polarityEvidence=${(polarityEvidence * 100).toFixed(0)}%`,
      })
    }
  }

  candidates.sort((a, b) => b.confidence - a.confidence)

  if (edgeCount < MIN_EDGES) {
    warnings.push(
      `有效电平跳变次数不足（${edgeCount} 次），无法可靠地自动检测比特率。` +
        '请手动选择比特率与极性。',
    )
  }
  const best = candidates[0]
  const reliable =
    edgeCount >= MIN_EDGES &&
    best !== undefined &&
    best.confidence >= CONFIDENCE_THRESHOLD
  if (!reliable && edgeCount >= MIN_EDGES) {
    warnings.push(
      '自动比特率检测置信度不足，结果仅供参考。请手动确认比特率与极性。',
    )
  }
  if (best !== undefined && Math.abs(best.polarityEvidence - 0.5) < 0.1) {
    warnings.push(
      '极性证据不足（空闲段过短或被截断），已保留两种极性候选；' +
        '最终以帧解码成功率（SOF/位填充/CRC/EOF）确认极性。',
    )
  }

  return { candidates, reliable, warnings }
}

/**
 * Share of idle-length run time spent at logic 1 under the quantized
 * mapping. Aggregates ALL runs at least `minRunSamples` long (including
 * possibly truncated boundary runs) instead of trusting the single longest
 * run. Returns 0.5 when no run qualifies (no evidence either way).
 */
function idleRecessiveShare(
  quantized: QuantizedSignal,
  minRunSamples: number,
): number {
  const { transitions, initialLevel, sampleCount } = quantized
  let recessiveTime = 0
  let totalTime = 0
  for (let run = 0; run < transitions.length; run += 1) {
    const start = transitions[run]
    const end =
      run + 1 < transitions.length ? transitions[run + 1] : sampleCount
    const length = end - start
    if (length < minRunSamples) continue
    totalTime += length
    if (((initialLevel ^ (run & 1)) & 1) === 1) recessiveTime += length
  }
  if (totalTime === 0) return 0.5
  return recessiveTime / totalTime
}
