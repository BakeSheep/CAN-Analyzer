import { detectBitrate } from '../core/bitrateDetector'
import { decodeCanFrames, type DecodeOutcome } from '../core/canDecoder'
import { parseScopeCsv } from '../core/csvParser'
import { quantize } from '../core/quantizer'
import type { AnalysisResult, Capture, QuantizedSignal } from '../core/types'
import type {
  AnalysisPhase,
  AnalyzeSettings,
  DigitalSeries,
  OverviewSeries,
} from './protocol'

/** Raised when the caller requests cancellation between passes. */
export class AnalysisCancelledError extends Error {
  constructor() {
    super('分析已取消。')
    this.name = 'AnalysisCancelledError'
  }
}

/** User-facing analysis failure with an actionable message. */
export class AnalysisError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AnalysisError'
  }
}

export interface PipelineHooks {
  onPhase?: (phase: AnalysisPhase, progress: number) => void
  shouldCancel?: () => boolean
}

export interface AnalysisOutput {
  result: AnalysisResult
  overview: OverviewSeries
  /** Exact transitions so the chart can render bit-level detail. */
  digital: DigitalSeries
}

/** Maximum number of decimated overview buckets sent to the UI. */
const OVERVIEW_BUCKETS = 4096

/**
 * Full analysis pipeline: parse → quantize → detect bitrate → decode.
 * Pure and synchronous so unit tests can drive it directly; the worker
 * adds message plumbing, cancellation polling, and buffer transfer.
 */
export function analyzeCaptureText(
  text: string,
  settings: AnalyzeSettings = {},
  hooks: PipelineHooks = {},
): AnalysisOutput {
  const report = (phase: AnalysisPhase, progress: number) =>
    hooks.onPhase?.(phase, progress)
  const checkCancel = () => {
    if (hooks.shouldCancel?.() === true) throw new AnalysisCancelledError()
  }

  // --- Phase 1: parse -------------------------------------------------
  report('reading', 0)
  const capture = parseScopeCsv(text, ({ processed, total }) => {
    checkCancel()
    report('reading', total > 0 ? processed / total : 0)
  })
  checkCancel()

  // --- Phase 2: quantize ------------------------------------------------
  report('quantizing', 0)
  const quantized = quantize(capture, {
    thresholdMv: settings.thresholdMv,
    hysteresisMv: settings.hysteresisMv,
    dominantIsLow: settings.dominantIsLow,
  })
  report('quantizing', 1)
  checkCancel()

  // --- Phase 3: detect bitrate ------------------------------------------
  report('detecting-bitrate', 0)
  const detection = detectBitrate(quantized, capture.metadata.sampleRateHz, {
    customBitrateBps: settings.customBitrateBps,
  })
  report('detecting-bitrate', 1)
  checkCancel()

  const warnings = [...quantized.warnings, ...detection.warnings]

  const manualBitrate = settings.bitrateBps !== undefined
  let bitrateBps: number
  if (settings.bitrateBps !== undefined) {
    if (!Number.isFinite(settings.bitrateBps) || settings.bitrateBps <= 0) {
      throw new AnalysisError(
        `手动比特率无效（${settings.bitrateBps}）：必须是正数。`,
      )
    }
    bitrateBps = settings.bitrateBps
  } else {
    const best = detection.candidates[0]
    if (best === undefined) {
      throw new AnalysisError(
        '未能检测到比特率：捕获中缺少足够的电平跳变。' +
          '请检查信号是否有效，或手动指定比特率。',
      )
    }
    bitrateBps = best.bitrateBps
    if (!detection.reliable) {
      warnings.push(
        `自动选择了置信度最高的比特率 ${bitrateBps} bit/s，但置信度不足，` +
          '请人工确认。',
      )
    }
  }
  const samplesPerBit = capture.metadata.sampleRateHz / bitrateBps
  if (samplesPerBit < 4) {
    throw new AnalysisError(
      `采样率相对比特率过低：每位仅 ${samplesPerBit.toFixed(2)} 个样本` +
        '（至少需要 4）。请降低比特率或使用更高采样率的捕获。',
    )
  }

  // --- Phase 4: decode ---------------------------------------------------
  report('decoding', 0)
  let invertPolarity: boolean
  let outcome: DecodeOutcome
  if (settings.invertPolarity !== undefined) {
    invertPolarity = settings.invertPolarity
    outcome = decodeCanFrames(quantized, { samplesPerBit, invertPolarity })
  } else {
    // Idle evidence only ranks the polarity candidates; frame decode
    // success (SOF/stuffing/CRC/EOF) makes the final call.
    const preferred =
      detection.candidates.find((c) => c.bitrateBps === bitrateBps)
        ?.invertPolarity ?? false
    const preferredOutcome = decodeCanFrames(quantized, {
      samplesPerBit,
      invertPolarity: preferred,
    })
    checkCancel()
    const oppositeOutcome = decodeCanFrames(quantized, {
      samplesPerBit,
      invertPolarity: !preferred,
    })
    // Switch only when the opposite polarity produces strictly better
    // results AND at least one fully valid frame: junk frames from a
    // wrong polarity must never beat “no frames found”.
    if (
      countValidFrames(oppositeOutcome) > 0 &&
      decodeScore(oppositeOutcome) > decodeScore(preferredOutcome)
    ) {
      invertPolarity = !preferred
      outcome = oppositeOutcome
      warnings.push(
        '极性已按帧解码成功率修正为与空闲证据相反的方向。',
      )
    } else {
      invertPolarity = preferred
      outcome = preferredOutcome
    }
  }
  report('decoding', 1)
  checkCancel()

  const result: AnalysisResult = {
    metadata: capture.metadata,
    levels: quantized.levels,
    settings: {
      thresholdMv: quantized.applied.thresholdMv,
      hysteresisMv: quantized.applied.hysteresisMv,
      dominantIsLow: quantized.applied.dominantIsLow,
      bitrateBps,
      invertPolarity,
      manualBitrate,
    },
    bitrate: detection,
    frames: outcome.frames,
    errors: outcome.errors,
    warnings,
  }
  // Exact run-length signal for deep-zoom rendering. `initialLevel` is a
  // LOGIC level; map it back to the voltage domain via the polarity that
  // the quantizer applied.
  const digital: DigitalSeries = {
    transitions: quantized.transitions,
    initialHigh: quantized.applied.dominantIsLow
      ? quantized.initialLevel === 1
      : quantized.initialLevel === 0,
    sampleCount: quantized.sampleCount,
  }

  return {
    result,
    overview: buildOverview(capture, OVERVIEW_BUCKETS),
    digital,
  }
}

/** Count frames with a valid CRC and no frame-level errors. */
function countValidFrames(outcome: DecodeOutcome): number {
  let valid = 0
  for (const frame of outcome.frames) {
    if (frame.crcValid && frame.errors.length === 0) valid += 1
  }
  return valid
}

/**
 * Rank a decode outcome for polarity confirmation. Only fully valid
 * frames earn points; invalid frames, their frame-level errors, and
 * capture-level errors all penalize, so a wrong polarity that produces
 * junk frames scores below an outcome with no frames at all.
 */
export function decodeScore(outcome: DecodeOutcome): number {
  let score = countValidFrames(outcome) * 100
  for (const frame of outcome.frames) {
    if (!frame.crcValid || frame.errors.length > 0) {
      score -= 10 + frame.errors.length
    }
  }
  score -= outcome.errors.length * 5
  return score
}

/**
 * Min/max envelope decimation. Exact transition/frame spans keep using
 * original sample indexes, so decimation never changes decode results.
 */
export function buildOverview(
  capture: Capture,
  maxBuckets: number,
): OverviewSeries {
  const { samples } = capture
  const n = samples.length
  const bucketSize = Math.max(1, Math.ceil(n / maxBuckets))
  const bucketCount = Math.ceil(n / bucketSize)
  const bucketStart = new Int32Array(bucketCount)
  const min = new Float32Array(bucketCount)
  const max = new Float32Array(bucketCount)
  for (let b = 0; b < bucketCount; b += 1) {
    const start = b * bucketSize
    const end = Math.min(start + bucketSize, n)
    let lo = samples[start]
    let hi = samples[start]
    for (let i = start + 1; i < end; i += 1) {
      const v = samples[i]
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    bucketStart[b] = start
    min[b] = lo
    max[b] = hi
  }
  return { bucketStart, min, max, bucketSize, sampleCount: n }
}

/** Re-quantize/decode support: expose for future incremental re-analysis. */
export type { QuantizedSignal }
