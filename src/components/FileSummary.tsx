import { useI18n } from '../app/i18n'
import type { AnalysisResult } from '../core/types'

interface FileSummaryProps {
  /** `null` before any CSV has been imported (placeholder mode). */
  fileName: string | null
  result: AnalysisResult | null
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
  const { t } = useI18n()

  const labels = [
    t('summary.sampleRate'),
    t('summary.sampleCount'),
    t('summary.duration'),
    t('summary.voltageRange'),
    t('summary.levels'),
    t('summary.threshold'),
    t('summary.bitrate'),
    t('summary.polarity'),
    t('summary.confidence'),
  ]

  let values: string[]
  let warnings: string[] = []
  if (result === null) {
    // Cards stay visible before import; every value is a dash.
    values = labels.map(() => '-')
  } else {
    const { metadata, levels, settings } = result
    warnings = result.warnings
    const duration =
      metadata.sampleRateHz > 0
        ? metadata.sampleCount / metadata.sampleRateHz
        : 0
    const unit = metadata.unit
    values = [
      formatHz(metadata.sampleRateHz),
      metadata.sampleCount.toLocaleString(),
      formatDuration(duration),
      `${metadata.min.toFixed(1)} ~ ${metadata.max.toFixed(1)} ${unit}`,
      t('summary.levelsValue', {
        low: levels.lowLevel.toFixed(0),
        high: levels.highLevel.toFixed(0),
        unit,
      }),
      `${settings.thresholdMv.toFixed(0)} ${unit}`,
      `${formatBitrate(settings.bitrateBps)}${settings.manualBitrate ? t('summary.manual') : t('summary.auto')}`,
      settings.invertPolarity ? t('summary.inverted') : t('summary.normal'),
      `${(levels.confidence * 100).toFixed(0)} %`,
    ]
  }

  const items: Array<[string, string]> = labels.map((label, i) => [
    label,
    values[i],
  ])

  return (
    <section aria-label={t('summary.aria')} className="file-summary">
      <h2 className="file-summary-name">{fileName ?? '-'}</h2>
      <dl className="file-summary-grid">
        {items.map(([label, value]) => (
          <div key={label} className="file-summary-item">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {warnings.length > 0 && (
        <ul className="file-summary-warnings" aria-label={t('summary.warningsAria')}>
          {warnings.map((warning) => (
            <li key={warning}>⚠ {warning}</li>
          ))}
        </ul>
      )}
    </section>
  )
}
