import {
  AnalysisCancelledError,
  analyzeCaptureText,
} from './analysisPipeline'
import { ScopeCsvParseError } from '../core/csvParser'
import type {
  AnalysisPhase,
  CompleteMessage,
  FailedMessage,
  ProgressMessage,
  WorkerRequest,
} from './protocol'

/** Worker global; cast because tsconfig also loads DOM types. */
const ctx = self as unknown as DedicatedWorkerGlobalScope

/** Requests cancelled by the main thread. */
const cancelledIds = new Set<number>()
/** Throttle progress messages to avoid flooding the channel. */
const PROGRESS_INTERVAL_MS = 60

ctx.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data
  if (message.type === 'cancel') {
    cancelledIds.add(message.requestId)
    return
  }
  void handleAnalyze(message.requestId, message.file, message.settings)
}

async function handleAnalyze(
  requestId: number,
  file: File,
  settings: Parameters<typeof analyzeCaptureText>[1],
): Promise<void> {
  const post = (
    response: ProgressMessage | CompleteMessage | FailedMessage,
    transfer: Transferable[] = [],
  ) => ctx.postMessage(response, transfer)

  let lastProgressAt = 0
  const reportProgress = (phase: AnalysisPhase, progress: number) => {
    const now = Date.now()
    if (progress < 1 && now - lastProgressAt < PROGRESS_INTERVAL_MS) return
    lastProgressAt = now
    post({ type: 'progress', requestId, phase, progress })
  }

  try {
    reportProgress('reading', 0)
    const text = await file.text()
    if (cancelledIds.has(requestId)) throw new AnalysisCancelledError()

    const { result, overview, digital } = analyzeCaptureText(text, settings, {
      onPhase: reportProgress,
      shouldCancel: () => cancelledIds.has(requestId),
    })
    if (cancelledIds.has(requestId)) throw new AnalysisCancelledError()

    // Transfer the overview/digital buffers instead of copying them.
    post(
      { type: 'complete', requestId, result, overview, digital },
      [
        overview.bucketStart.buffer,
        overview.min.buffer,
        overview.max.buffer,
        digital.transitions.buffer,
      ],
    )
  } catch (error) {
    if (error instanceof AnalysisCancelledError) {
      post({
        type: 'failed',
        requestId,
        message: error.message,
        cancelled: true,
      })
    } else if (error instanceof ScopeCsvParseError) {
      post({
        type: 'failed',
        requestId,
        message: error.message,
        line: error.line,
      })
    } else {
      post({
        type: 'failed',
        requestId,
        message:
          error instanceof Error ? error.message : '分析过程中出现未知错误。',
      })
    }
  } finally {
    cancelledIds.delete(requestId)
  }
}
