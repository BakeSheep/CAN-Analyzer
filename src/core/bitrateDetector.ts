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
 */
export function detectBitrate(
  quantized: QuantizedSignal,
  sampleRateHz: number,
  options: BitrateDetectorOptions = {},
): BitrateDetection {
  const { transitions, initialLevel } = quantized
  const warnings: string[] = []

  // transitions[0] is the capture start, not a real edge.
  const edgeCount = Math.max(0, transitions.length - 1)
  const intervals: number[] = []
  for (let i = 2; i < transitions.length; i += 1) {
    intervals.push(transitions[i] - transitions[i - 1])
  }

  // The longest run should be recessive idle; if it is logic 0 the
  // polarity mapping must be inverted before decoding.
  const invertPolarity = longestRunLevel(quantized) === 0

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
    let phaseOffsetSamples =
      (Math.atan2(sumSin, sumCos) / (2 * Math.PI)) * samplesPerBit
    if (phaseOffsetSamples < 0) phaseOffsetSamples += samplesPerBit

    // Sub-harmonic candidates (double/quadruple rate) fit every interval
    // but never see single-bit intervals, which stuffing guarantees.
    const singleBitShare = singleBitCount / intervals.length
    const singleBitFactor = 0.4 + 0.6 * Math.min(1, singleBitShare * 4)
    const edgeFactor = Math.min(1, edgeCount / 16)
    const phaseFactor = 0.5 + 0.5 * phaseR

    const confidence =
      timingScore * phaseFactor * edgeFactor * singleBitFactor
    candidates.push({
      bitrateBps,
      samplesPerBit,
      confidence,
      invertPolarity,
      phaseOffsetSamples,
      diagnostics:
        `spb=${samplesPerBit.toFixed(2)}, edges=${edgeCount}, ` +
        `meanResidual=${(meanResidual * 100).toFixed(1)}%, ` +
        `phaseR=${phaseR.toFixed(2)}, ` +
        `singleBitShare=${(singleBitShare * 100).toFixed(0)}%`,
    })
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

  // Keep `initialLevel` reserved for future diagnostics; polarity is judged
  // from the longest run so a capture that starts mid-frame stays correct.
  void initialLevel

  return { candidates, reliable, warnings }
}

/** Logic level of the longest run in the quantized signal. */
function longestRunLevel(quantized: QuantizedSignal): 0 | 1 {
  const { transitions, initialLevel, sampleCount } = quantized
  let bestLength = -1
  let bestLevel: 0 | 1 = initialLevel
  for (let run = 0; run < transitions.length; run += 1) {
    const start = transitions[run]
    const end = run + 1 < transitions.length ? transitions[run + 1] : sampleCount
    const length = end - start
    if (length > bestLength) {
      bestLength = length
      bestLevel = ((initialLevel ^ (run & 1)) & 1) as 0 | 1
    }
  }
  return bestLevel
}
