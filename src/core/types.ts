/**
 * Stable domain contracts shared by the parser, quantizer, bitrate detector,
 * CAN decoder, worker protocol, and UI.
 *
 * Sample indexes are the canonical time coordinate. Seconds are derived as
 * `sampleIndex / sampleRateHz` only for display purposes.
 */

export interface CaptureMetadata {
  /** Samples per second declared by the oscilloscope header. */
  sampleRateHz: number
  /** Voltage unit from the header channel column, e.g. `mV`. */
  unit: string
  /** Probe attenuation string from the header, e.g. `X1`. */
  probe?: string
  sampleCount: number
  /** Minimum sample value in `unit`. */
  min: number
  /** Maximum sample value in `unit`. */
  max: number
}

export interface Capture {
  metadata: CaptureMetadata
  /** Voltage samples in `metadata.unit`. */
  samples: Float32Array
}

/** Derived display-only duration. */
export function captureDurationSeconds(capture: Capture): number {
  if (capture.metadata.sampleRateHz <= 0) return 0
  return capture.metadata.sampleCount / capture.metadata.sampleRateHz
}

/** Result of two-level clustering over the analog waveform. */
export interface SignalLevels {
  /** Estimated center of the lower voltage cluster, in capture units. */
  lowLevel: number
  /** Estimated center of the upper voltage cluster, in capture units. */
  highLevel: number
  /** Decision threshold, in capture units. */
  threshold: number
  /** Hysteresis band width, in capture units. */
  hysteresis: number
  /** Robust within-cluster noise estimate, in capture units. */
  noiseEstimate: number
  /** 0..1 confidence that the capture is genuinely two-level. */
  confidence: number
}

/** Manual overrides accepted by the quantizer; preserved for reproducibility. */
export interface QuantizerOptions {
  thresholdMv?: number
  hysteresisMv?: number
  /** When true, the dominant CAN level maps to the LOW voltage cluster. */
  dominantIsLow?: boolean
}

/**
 * Digital view of the capture encoded as transition runs, not per-sample
 * objects. Run `k` spans `transitions[k] .. transitions[k + 1] - 1` and has
 * logic level `initialLevel XOR (k & 1)`.
 */
export interface QuantizedSignal {
  /** Sample index where each run starts; `transitions[0]` is always 0. */
  transitions: Int32Array
  /** Logic level (0/1 after polarity mapping) of the first run. */
  initialLevel: 0 | 1
  /** Total number of samples covered (equals capture sampleCount). */
  sampleCount: number
  levels: SignalLevels
  /** Options actually applied (defaults merged with overrides). */
  applied: Required<QuantizerOptions>
  /** Actionable warnings, e.g. low-confidence clustering. */
  warnings: string[]
}

export interface BitrateCandidate {
  bitrateBps: number
  samplesPerBit: number
  /** 0..1 score; higher ranks first. */
  confidence: number
  /**
   * True when the signal must be inverted so idle is recessive (1).
   * Both polarity variants are retained as separate candidates; the
   * decoder confirms the winner via SOF/stuffing/CRC/EOF success.
   */
  invertPolarity: boolean
  /** 0..1 idle-level evidence supporting this polarity; 0.5 = ambiguous. */
  polarityEvidence: number
  /**
   * Phase of the bit BOUNDARIES within the capture, in samples,
   * modulo `samplesPerBit`. This is NOT a sampling point.
   */
  bitBoundaryOffsetSamples: number
  /**
   * Recommended decoder sampling position modulo `samplesPerBit`:
   * the bit boundary phase plus 75% of a bit period.
   */
  samplePointOffsetSamples: number
  /** Human-readable scoring diagnostics. */
  diagnostics: string
}

export interface BitrateDetection {
  /** Candidates ranked best-first; may be empty for flat captures. */
  candidates: BitrateCandidate[]
  /** True when the best candidate clears the confidence threshold. */
  reliable: boolean
  warnings: string[]
}

/** One sampled raw bit with its provenance inside the capture. */
export interface BitSample {
  value: 0 | 1
  /** Index within the raw (still stuffed) bit stream. */
  rawBitIndex: number
  /** First sample index covered by this bit. */
  startSample: number
  /** Exclusive end sample index. */
  endSample: number
  /** True when the bit was consumed as a stuff bit. */
  isStuffBit: boolean
}

export type CanFrameFormat = 'standard' | 'extended'

export type CanFieldName =
  | 'sof'
  | 'arbitration'
  | 'control'
  | 'data'
  | 'crc'
  | 'ack'
  | 'eof'

export interface CanFieldSpan {
  field: CanFieldName
  startSample: number
  endSample: number
}

export type DecodeErrorCode =
  | 'stuff-error'
  | 'crc-mismatch'
  | 'crc-delimiter-error'
  | 'ack-delimiter-error'
  | 'eof-error'
  | 'invalid-dlc'
  | 'truncated-frame'
  | 'form-error'

export interface DecodeError {
  code: DecodeErrorCode
  message: string
  startSample: number
  endSample: number
  rawBitIndex?: number
  logicalBitIndex?: number
}

export interface CanFrame {
  /** Zero-based frame index within the capture. */
  index: number
  startSample: number
  endSample: number
  format: CanFrameFormat
  /** Numeric identifier (11-bit or 29-bit). */
  id: number
  /** Uppercase hex identifier without prefix. */
  idHex: string
  rtr: boolean
  dlc: number
  /** 0-8 payload bytes; empty for remote frames. */
  data: Uint8Array
  /** Received CRC-15 value. */
  crc: number
  crcValid: boolean
  acknowledged: boolean
  errors: DecodeError[]
  fields: CanFieldSpan[]
}

export interface AnalysisSettings {
  thresholdMv: number
  hysteresisMv: number
  dominantIsLow: boolean
  bitrateBps: number
  invertPolarity: boolean
  /** True when the bitrate was chosen manually rather than detected. */
  manualBitrate: boolean
}

export interface AnalysisResult {
  metadata: CaptureMetadata
  levels: SignalLevels
  settings: AnalysisSettings
  bitrate: BitrateDetection
  frames: CanFrame[]
  /** Capture-level errors not attached to a specific frame. */
  errors: DecodeError[]
  warnings: string[]
}
