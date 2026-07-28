import type { AnalysisResult } from '../core/types'

interface FileSummaryProps {
  fileName: string
  result: AnalysisResult
}

function formatHz(hz: number): string {
  if (hz >= 1_000_000) return `${(hz / 1_000_000).toLocaleString()} MHz`
  if (hz >= 1_000) return `${(hz / 1_000).toLocaleString()} kHz`
  return `${hz.toLocaleString()} Hz`
}

function formatBitrate(bps: number): string {
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toLocaleString()} Mbit/s`
  if (bps >= 1_000) return `${(bps / 1_000).toLocaleString()} kbit/s`
  return `${bps.toLocaleString()} bit/s`
}

function formatDuration(seconds: number): string {
  if (seconds >= 1) return `${seconds.toFixed(4)} s`
  if (seconds >= 1e-3) return `${(seconds * 1e3).toFixed(4)} ms`
  return `${(seconds * 1e6).toFixed(1)} µs`
}

/** Capture metadata, detected levels, and analysis settings at a glance. */
export function FileSummary({ fileName, result }: FileSummaryProps) {
  const { metadata, levels, settings, warnings } = result
  const duration =
    metadata.sampleRateHz > 0 ? metadata.sampleCount / metadata.sampleRateHz : 0
  const unit = metadata.unit

  const items: Array<[string, string]> = [
    ['采样率', formatHz(metadata.sampleRateHz)],
    ['样本数', metadata.sampleCount.toLocaleString()],
    ['时长', formatDuration(duration)],
    [
      '电压范围',
      `${metadata.min.toFixed(1)} ~ ${metadata.max.toFixed(1)} ${unit}`,
    ],
    [
      '检测电平',
      `低 ${levels.lowLevel.toFixed(0)} / 高 ${levels.highLevel.toFixed(0)} ${unit}`,
    ],
    ['判决阈值', `${settings.thresholdMv.toFixed(0)} ${unit}`],
    [
      '比特率',
      `${formatBitrate(settings.bitrateBps)}${settings.manualBitrate ? '（手动）' : '（自动）'}`,
    ],
    ['极性', settings.invertPolarity ? '反转' : '正常'],
    ['电平置信度', `${(levels.confidence * 100).toFixed(0)} %`],
  ]

  return (
    <section aria-label="文件摘要" className="file-summary">
      <h2 className="file-summary-name">{fileName}</h2>
      <dl className="file-summary-grid">
        {items.map(([label, value]) => (
          <div key={label} className="file-summary-item">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {warnings.length > 0 && (
        <ul className="file-summary-warnings" aria-label="分析警告">
          {warnings.map((warning) => (
            <li key={warning}>⚠ {warning}</li>
          ))}
        </ul>
      )}
    </section>
  )
}
