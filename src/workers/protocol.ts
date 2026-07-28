import type { AnalysisResult } from '../core/types'

/** Manual overrides supplied by the UI; all fields optional. */
export interface AnalyzeSettings {
  thresholdMv?: number
  hysteresisMv?: number
  dominantIsLow?: boolean
  /** Manual bitrate; skips automatic selection when set. */
  bitrateBps?: number
  /** Manual polarity; skips decode-based polarity confirmation when set. */
  invertPolarity?: boolean
  /** Extra rate evaluated by the automatic detector. */
  customBitrateBps?: number
}

/** Decimated min/max envelope for plotting large captures. */
export interface OverviewSeries {
  /** First sample index of each bucket. */
  bucketStart: Int32Array
  min: Float32Array
  max: Float32Array
  bucketSize: number
  sampleCount: number
}

export type AnalysisPhase =
  | 'reading'
  | 'quantizing'
  | 'detecting-bitrate'
  | 'decoding'

export interface AnalyzeRequestMessage {
  type: 'analyze'
  requestId: number
  /** File to analyze; read inside the worker. */
  file: File
  settings: AnalyzeSettings
}

export interface CancelRequestMessage {
  type: 'cancel'
  requestId: number
}

export type WorkerRequest = AnalyzeRequestMessage | CancelRequestMessage

export interface ProgressMessage {
  type: 'progress'
  requestId: number
  phase: AnalysisPhase
  /** 0..1 within the current phase. */
  progress: number
}

export interface CompleteMessage {
  type: 'complete'
  requestId: number
  result: AnalysisResult
  overview: OverviewSeries
}

export interface FailedMessage {
  type: 'failed'
  requestId: number
  message: string
  /** 1-based CSV line number for parse errors. */
  line?: number
  cancelled?: boolean
}

export type WorkerResponse = ProgressMessage | CompleteMessage | FailedMessage
