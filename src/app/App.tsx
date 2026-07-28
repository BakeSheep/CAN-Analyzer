import { useCallback, useEffect, useRef, useState } from 'react'
import { AnalyzerControls } from '../components/AnalyzerControls'
import { DropZone } from '../components/DropZone'
import { ErrorBanner } from '../components/ErrorBanner'
import { FileSummary } from '../components/FileSummary'
import { FrameDetails } from '../components/FrameDetails'
import { FrameTable } from '../components/FrameTable'
import { WaveformChart } from '../components/WaveformChart'
import type { AnalysisResult } from '../core/types'
import type {
  AnalysisPhase,
  AnalyzeSettings,
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

  const [loading, setLoading] = useState<LoadingState | null>(null)
  const [analyzed, setAnalyzed] = useState<AnalyzedData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedFrame, setSelectedFrame] = useState<number | null>(null)

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
          setLoading((current) => {
            setAnalyzed({
              fileName: current?.fileName ?? '',
              result: message.result,
              overview: message.overview,
            })
            return null
          })
          setSelectedFrame(null)
        } else {
          setLoading(null)
          if (!message.cancelled) setError(message.message)
        }
      }
    }
    return workerRef.current
  }, [])

  useEffect(() => {
    return () => {
      workerRef.current?.terminate()
      workerRef.current = null
    }
  }, [])

  const analyze = useCallback(
    (file: File, settings: AnalyzeSettings = {}) => {
      const worker = ensureWorker()
      // A new file/settings run supersedes (cancels) the previous request.
      const previousId = requestIdRef.current
      if (loading !== null) {
        worker.postMessage({ type: 'cancel', requestId: previousId })
      }
      requestIdRef.current = previousId + 1
      lastFileRef.current = file
      setError(null)
      setLoading({ fileName: file.name, phase: 'reading', progress: 0 })
      worker.postMessage({
        type: 'analyze',
        requestId: requestIdRef.current,
        file,
        settings,
      })
    },
    [ensureWorker, loading],
  )

  const cancel = useCallback(() => {
    workerRef.current?.postMessage({
      type: 'cancel',
      requestId: requestIdRef.current,
    })
    requestIdRef.current += 1
    setLoading(null)
  }, [])

  const reanalyze = useCallback(
    (overrides: AnalyzeSettings) => {
      const file = lastFileRef.current
      if (file !== null) analyze(file, overrides)
    },
    [analyze],
  )

  const result = analyzed?.result ?? null

  return (
    <>
      <header className="app-header">
        <h1>CAN Waveform Analyzer</h1>
        <p className="privacy-note">
          导入示波器 CSV，检测比特率并解码 Classic CAN 帧。分析全部在本地浏览器完成，数据不会上传。
        </p>
      </header>
      <main className="app-main">
        <section aria-label="导入与状态" className="import-section">
          <DropZone onFile={(file) => analyze(file)} disabled={loading !== null} />
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
            <div className="summary-row">
              <FileSummary fileName={analyzed.fileName} result={result} />
              <AnalyzerControls
                settings={result.settings}
                onApply={reanalyze}
                disabled={loading !== null}
              />
            </div>
            <WaveformChart
              overview={analyzed.overview}
              frames={result.frames}
              selectedIndex={selectedFrame}
              onSelectFrame={setSelectedFrame}
              sampleRateHz={result.metadata.sampleRateHz}
              unit={result.metadata.unit}
              threshold={result.settings.thresholdMv}
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
