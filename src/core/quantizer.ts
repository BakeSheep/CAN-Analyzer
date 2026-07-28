import type {
  Capture,
  QuantizedSignal,
  QuantizerOptions,
  SignalLevels,
} from './types'

const HISTOGRAM_BINS = 256
const MAX_CLUSTER_ITERATIONS = 64
/** Confidence below this triggers an actionable warning. */
const LOW_CONFIDENCE = 0.5
/** Required separation between clusters, expressed in noise sigmas. */
const MIN_SEPARATION_SIGMA = 6
/** Minimum share of samples in the minority cluster. */
const MIN_MINORITY_SHARE = 0.001

/**
 * Quantize an analog capture into a run-length encoded digital signal.
 *
 * Levels are estimated with a fixed-size histogram and two-cluster
 * iteration over bin centers (initialized from the 10th/90th percentiles).
 * The threshold defaults to the cluster midpoint and the hysteresis band
 * to 10% of the cluster separation; both can be overridden.
 */
export function quantize(
  capture: Capture,
  options: QuantizerOptions = {},
): QuantizedSignal {
  validateOptions(options)
  const { samples } = capture
  const estimate = estimateLevels(samples)
  const warnings: string[] = []

  const thresholdMv =
    options.thresholdMv ?? (estimate.lowLevel + estimate.highLevel) / 2
  const hysteresisMv =
    options.hysteresisMv ?? 0.1 * (estimate.highLevel - estimate.lowLevel)
  const dominantIsLow = options.dominantIsLow ?? estimate.lowIsMinority

  if (estimate.confidence < LOW_CONFIDENCE) {
    warnings.push(
      `波形两电平区分度不足（置信度 ${(estimate.confidence * 100).toFixed(0)}%）。` +
        '请检查捕获是否包含有效 CAN 信号，或手动设置判决阈值与滞回带。',
    )
  }

  const levels: SignalLevels = {
    lowLevel: estimate.lowLevel,
    highLevel: estimate.highLevel,
    threshold: thresholdMv,
    hysteresis: hysteresisMv,
    noiseEstimate: estimate.noise,
    confidence: estimate.confidence,
  }

  const { transitions, initialHighVoltage } = runLengthEncode(
    samples,
    thresholdMv,
    hysteresisMv,
  )

  // Logic mapping: recessive (1) is the opposite level of the dominant one.
  // dominantIsLow=true → high voltage cluster is recessive → high=1.
  const initialLevel: 0 | 1 = dominantIsLow
    ? initialHighVoltage
      ? 1
      : 0
    : initialHighVoltage
      ? 0
      : 1

  return {
    transitions,
    initialLevel,
    sampleCount: samples.length,
    levels,
    applied: { thresholdMv, hysteresisMv, dominantIsLow },
    warnings,
  }
}

/** Reject manual overrides that would silently corrupt quantization. */
function validateOptions(options: QuantizerOptions): void {
  if (
    options.thresholdMv !== undefined &&
    !Number.isFinite(options.thresholdMv)
  ) {
    throw new RangeError(
      `手动阈值无效（${options.thresholdMv}）：必须是有限数值（mV）。`,
    )
  }
  if (options.hysteresisMv !== undefined) {
    if (!Number.isFinite(options.hysteresisMv) || options.hysteresisMv < 0) {
      throw new RangeError(
        `手动滞回带无效（${options.hysteresisMv}）：必须是非负的有限数值（mV）。`,
      )
    }
  }
}

interface LevelEstimate {
  lowLevel: number
  highLevel: number
  noise: number
  confidence: number
  /** True when the low cluster holds fewer samples than the high cluster. */
  lowIsMinority: boolean
}

function estimateLevels(samples: Float32Array): LevelEstimate {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const v of samples) {
    if (v < min) min = v
    if (v > max) max = v
  }
  if (!(max > min)) {
    // Flat capture: no measurable separation.
    return {
      lowLevel: min,
      highLevel: max,
      noise: 0,
      confidence: 0,
      lowIsMinority: false,
    }
  }

  // Fixed-size histogram keeps memory constant for any capture length.
  const counts = new Float64Array(HISTOGRAM_BINS)
  const scale = (HISTOGRAM_BINS - 1) / (max - min)
  for (const v of samples) {
    counts[Math.round((v - min) * scale)] += 1
  }
  const binCenter = (bin: number) => min + bin / scale

  // Initialize the two cluster centers from the 10th/90th percentiles.
  let c0 = binCenter(percentileBin(counts, samples.length, 0.1))
  let c1 = binCenter(percentileBin(counts, samples.length, 0.9))
  if (c0 === c1) c1 = c0 + (max - min) / HISTOGRAM_BINS

  // Weighted two-mean iteration over bin centers until stable.
  for (let iter = 0; iter < MAX_CLUSTER_ITERATIONS; iter += 1) {
    let sum0 = 0
    let n0 = 0
    let sum1 = 0
    let n1 = 0
    const cut = (c0 + c1) / 2
    for (let bin = 0; bin < HISTOGRAM_BINS; bin += 1) {
      const weight = counts[bin]
      if (weight === 0) continue
      const center = binCenter(bin)
      if (center <= cut) {
        sum0 += center * weight
        n0 += weight
      } else {
        sum1 += center * weight
        n1 += weight
      }
    }
    const next0 = n0 > 0 ? sum0 / n0 : c0
    const next1 = n1 > 0 ? sum1 / n1 : c1
    if (next0 === c0 && next1 === c1) break
    c0 = next0
    c1 = next1
  }

  // Within-cluster spread (weighted standard deviation) around each center.
  const cut = (c0 + c1) / 2
  let var0 = 0
  let n0 = 0
  let var1 = 0
  let n1 = 0
  for (let bin = 0; bin < HISTOGRAM_BINS; bin += 1) {
    const weight = counts[bin]
    if (weight === 0) continue
    const center = binCenter(bin)
    if (center <= cut) {
      var0 += weight * (center - c0) ** 2
      n0 += weight
    } else {
      var1 += weight * (center - c1) ** 2
      n1 += weight
    }
  }
  const sigma0 = n0 > 1 ? Math.sqrt(var0 / n0) : 0
  const sigma1 = n1 > 1 ? Math.sqrt(var1 / n1) : 0
  const noise = Math.max(sigma0, sigma1, (max - min) / HISTOGRAM_BINS)

  const separation = c1 - c0
  const minorityShare = Math.min(n0, n1) / Math.max(samples.length, 1)
  let confidence = Math.min(1, separation / (MIN_SEPARATION_SIGMA * noise) / 2)
  if (minorityShare < MIN_MINORITY_SHARE) confidence = 0

  return {
    lowLevel: c0,
    highLevel: c1,
    noise,
    confidence,
    lowIsMinority: n0 < n1,
  }
}

function percentileBin(
  counts: Float64Array,
  total: number,
  fraction: number,
): number {
  const target = total * fraction
  let cumulative = 0
  for (let bin = 0; bin < counts.length; bin += 1) {
    cumulative += counts[bin]
    if (cumulative >= target) return bin
  }
  return counts.length - 1
}

function runLengthEncode(
  samples: Float32Array,
  threshold: number,
  hysteresis: number,
): { transitions: Int32Array; initialHighVoltage: boolean } {
  const upper = threshold + hysteresis / 2
  const lower = threshold - hysteresis / 2
  const raw: number[] = [0]

  // Initial state: compare the first sample against the plain threshold.
  let high = samples.length > 0 ? samples[0] > threshold : false
  const initialHighVoltage = high

  for (let i = 1; i < samples.length; i += 1) {
    const v = samples[i]
    if (high) {
      if (v < lower) {
        high = false
        raw.push(i)
      }
    } else if (v > upper) {
      high = true
      raw.push(i)
    }
  }
  return { transitions: Int32Array.from(raw), initialHighVoltage }
}
