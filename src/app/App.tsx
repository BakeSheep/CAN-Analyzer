import { useCallback, useEffect, useRef, useState } from 'react'
import { AnalyzerControls } from '../components/AnalyzerControls'
import { DropZone } from '../components/DropZone'
import { ErrorBanner } from '../components/ErrorBanner'
import { FileSummary } from '../components/FileSummary'
import { FrameDetails } from '../components/FrameDetails'
import { FrameTable } from '../components/FrameTable'
import { WaveformChart } from '../components/WaveformChart'
import { framesToCsv, framesToJson } from '../core/exporters'
import type { AnalysisResult } from '../core/types'
import type {
  AnalysisPhase,
  AnalyzeSettings,
  DigitalSeries,
  OverviewSeries,
  WorkerResponse,
} from '../workers/protocol'

const PHASE_LABELS: Record<AnalysisPhase, string> = {
  reading: '读取文件',
  quantizing: '量化波形',
  'detecting-bitrate': '检测比特率',
  decoding: '解码 CAN 帧',
}

interface AnalyzedData {
  fileName: string
  result: AnalysisResult
  overview: OverviewSeries
  digital: DigitalSeries
}

interface LoadingState {
  fileName: string
  phase: AnalysisPhase
  progress: number
}

export default function App() {
  const workerRef = useRef<Worker | null>(null)
  const requestIdRef = useRef(0)
  const lastFileRef = useRef<File | null>(null)
  /** Mirrors `loading` for callbacks that must not capture stale state. */
  const loadingRef = useRef<LoadingState | null>(null)
  /** File name of the in-flight request, used when `complete` arrives. */
  const pendingNameRef = useRef('')

  const [loading, setLoading] = useState<LoadingState | null>(null)
  const [analyzed, setAnalyzed] = useState<AnalyzedData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedFrame, setSelectedFrame] = useState<number | null>(null)

  const updateLoading = useCallback(
    (value: LoadingState | null) => {
      loadingRef.current = value
      setLoading(value)
    },
    [],
  )

  const ensureWorker = useCallback((): Worker => {
    if (workerRef.current === null) {
      workerRef.current = new Worker(
        new URL('../workers/analyzer.worker.ts', import.meta.url),
        { type: 'module' },
      )
      workerRef.current.onmessage = (
        event: MessageEvent<WorkerResponse>,
      ) => {
        const message = event.data
        // Ignore late messages from superseded/cancelled requests.
        if (message.requestId !== requestIdRef.current) return
        if (message.type === 'progress') {
          setLoading((current) =>
            current === null
              ? current
              : {
                  ...current,
                  phase: message.phase,
                  progress: message.progress,
                },
          )
        } else if (message.type === 'complete') {
          setAnalyzed({
            fileName: pendingNameRef.current,
            result: message.result,
            overview: message.overview,
            digital: message.digital,
          })
          setSelectedFrame(null)
          updateLoading(null)
        } else {
          updateLoading(null)
          if (!message.cancelled) setError(message.message)
        }
      }
    }
    return workerRef.current
  }, [updateLoading])

  /**
   * Hard-stop the in-flight analysis. The pipeline runs synchronously
   * inside the worker, so `cancel` messages cannot interrupt it;
   * terminating the worker is the only reliable way to free it.
   */
  const abortInFlight = useCallback(() => {
    if (loadingRef.current !== null && workerRef.current !== null) {
      workerRef.current.terminate()
      workerRef.current = null
    }
    requestIdRef.current += 1
    updateLoading(null)
  }, [updateLoading])

  useEffect(() => {
    return () => {
      workerRef.current?.terminate()
      workerRef.current = null
    }
  }, [])

  const analyze = useCallback(
    (file: File, settings: AnalyzeSettings = {}) => {
      // A new file/settings run supersedes the previous request.
      abortInFlight()
      lastFileRef.current = file
      pendingNameRef.current = file.name
      // Keep the empty/loading/analyzed/error states mutually exclusive:
      // stale results must never sit next to a newer file's error.
      setError(null)
      setAnalyzed(null)
      setSelectedFrame(null)
      updateLoading({ fileName: file.name, phase: 'reading', progress: 0 })
      ensureWorker().postMessage({
        type: 'analyze',
        requestId: requestIdRef.current,
        file,
        settings,
      })
    },
    [abortInFlight, ensureWorker, updateLoading],
  )

  const cancel = useCallback(() => {
    abortInFlight()
  }, [abortInFlight])

  const reanalyze = useCallback(
    (overrides: AnalyzeSettings) => {
      const file = lastFileRef.current
      if (file !== null) analyze(file, overrides)
    },
    [analyze],
  )

  const downloadText = useCallback(
    (content: string, mimeType: string, extension: string) => {
      if (analyzed === null) return
      const blob = new Blob([content], { type: mimeType })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${analyzed.fileName.replace(/\.[^.]+$/, '')}-frames.${extension}`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    },
    [analyzed],
  )

  const exportJson = useCallback(() => {
    if (analyzed === null) return
    downloadText(
      framesToJson(analyzed.result, analyzed.result.frames),
      'application/json',
      'json',
    )
  }, [analyzed, downloadText])

  const exportCsv = useCallback(() => {
    if (analyzed === null) return
    downloadText(
      framesToCsv(analyzed.result.frames, analyzed.result.metadata.sampleRateHz),
      'text/csv',
      'csv',
    )
  }, [analyzed, downloadText])

  const result = analyzed?.result ?? null

  return (
    <>
      <header className="app-header">
        <h1>CAN Waveform Analyzer</h1>
        <a
          className="github-link"
          href="https://github.com/bakesheep/CAN-Analyzer"
          target="_blank"
          rel="noopener noreferrer"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            width="16"
            height="16"
            fill="currentColor"
          >
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
          </svg>
          GitHub
        </a>
      </header>
      <main className="app-main">
        <div className="top-row">
          <section aria-label="导入与状态" className="import-card">
            {/* Import stays enabled during analysis: a new file supersedes
                (terminates) the in-flight request. */}
            <DropZone onFile={(file) => analyze(file)} disabled={false} />
            {loading !== null && (
              <div className="progress-panel" aria-live="polite">
                <p>
                  正在分析 {loading.fileName}：{PHASE_LABELS[loading.phase]}（
                  {Math.round(loading.progress * 100)}%）
                </p>
                <progress max={1} value={loading.progress} />
                <button type="button" onClick={cancel}>
                  取消
                </button>
              </div>
            )}
            {error !== null && (
              <ErrorBanner message={error} onDismiss={() => setError(null)} />
            )}
          </section>
          {analyzed !== null && result !== null && (
            <>
              <FileSummary fileName={analyzed.fileName} result={result} />
              <AnalyzerControls
                settings={result.settings}
                onApply={reanalyze}
                disabled={loading !== null}
              />
            </>
          )}
        </div>

        {analyzed !== null && result !== null && (
          <>
            <WaveformChart
              overview={analyzed.overview}
              digital={analyzed.digital}
              frames={result.frames}
              selectedIndex={selectedFrame}
              onSelectFrame={setSelectedFrame}
              sampleRateHz={result.metadata.sampleRateHz}
              unit={result.metadata.unit}
              threshold={result.settings.thresholdMv}
              levels={result.levels}
            />
            {result.errors.length > 0 && (
              <section aria-label="捕获级错误" className="capture-errors">
                <h3>捕获级错误</h3>
                <ul>
                  {result.errors.map((decodeError) => (
                    <li key={`${decodeError.code}-${decodeError.startSample}`}>
                      <strong>{decodeError.code}</strong>：
                      {decodeError.message}（样本 {decodeError.startSample} –{' '}
                      {decodeError.endSample}）
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <div className="inspect-split">
              <FrameTable
                frames={result.frames}
                selectedIndex={selectedFrame}
                onSelect={setSelectedFrame}
                sampleRateHz={result.metadata.sampleRateHz}
                actions={
                  <>
                    {/* Export lives in the frame card's top-right corner;
                        labels state explicitly that ALL frames export. */}
                    <button
                      type="button"
                      onClick={exportJson}
                      disabled={loading !== null}
                    >
                      导出全部帧 JSON
                    </button>
                    <button
                      type="button"
                      onClick={exportCsv}
                      disabled={loading !== null}
                    >
                      导出全部帧 CSV
                    </button>
                  </>
                }
              />
              <FrameDetails
                frame={
                  selectedFrame === null
                    ? null
                    : (result.frames.find((f) => f.index === selectedFrame) ??
                      null)
                }
                sampleRateHz={result.metadata.sampleRateHz}
              />
            </div>
          </>
        )}
      </main>
      <footer className="app-footer">
        <p>MIT Licensed · Classic CAN 2.0A/2.0B · v0.1.0</p>
      </footer>
    </>
  )
}
