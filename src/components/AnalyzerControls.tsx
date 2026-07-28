import { useState, type FormEvent } from 'react'
import { COMMON_BITRATES } from '../core/bitrateDetector'
import type { AnalysisSettings } from '../core/types'
import type { AnalyzeSettings } from '../workers/protocol'

interface AnalyzerControlsProps {
  settings: AnalysisSettings
  onApply: (overrides: AnalyzeSettings) => void
  disabled: boolean
}

/** Manual overrides: bitrate, threshold, hysteresis, and polarity. */
export function AnalyzerControls({
  settings,
  onApply,
  disabled,
}: AnalyzerControlsProps) {
  const [bitrate, setBitrate] = useState<string>('auto')
  const [customBitrate, setCustomBitrate] = useState<string>('')
  const [customError, setCustomError] = useState<string | null>(null)
  const [threshold, setThreshold] = useState<string>('')
  const [hysteresis, setHysteresis] = useState<string>('')
  const [polarity, setPolarity] = useState<string>('auto')

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    const overrides: AnalyzeSettings = {}
    if (bitrate === 'custom') {
      const parsed = Number(customBitrate)
      if (customBitrate.trim() === '' || !Number.isFinite(parsed) || parsed <= 0) {
        // Never silently fall back to auto detection: block the submit
        // and surface a field-level error instead.
        setCustomError('请输入大于 0 的自定义比特率（bit/s）。')
        return
      }
      setCustomError(null)
      overrides.bitrateBps = parsed
    } else if (bitrate !== 'auto') {
      overrides.bitrateBps = Number(bitrate)
    }
    if (threshold.trim() !== '') {
      const parsed = Number(threshold)
      if (Number.isFinite(parsed)) overrides.thresholdMv = parsed
    }
    if (hysteresis.trim() !== '') {
      const parsed = Number(hysteresis)
      if (Number.isFinite(parsed) && parsed >= 0) {
        overrides.hysteresisMv = parsed
      }
    }
    if (polarity === 'invert') overrides.invertPolarity = true
    else if (polarity === 'normal') overrides.invertPolarity = false
    onApply(overrides)
  }

  return (
    <form
      className="analyzer-controls"
      aria-label="分析设置"
      noValidate
      onSubmit={handleSubmit}
    >
      <div className="control-field">
        <label htmlFor="control-bitrate">比特率</label>
        <select
          id="control-bitrate"
          value={bitrate}
          onChange={(e) => setBitrate(e.target.value)}
          disabled={disabled}
        >
          <option value="auto">自动检测（当前 {settings.bitrateBps}）</option>
          {COMMON_BITRATES.map((rate) => (
            <option key={rate} value={rate}>
              {rate >= 1_000_000
                ? `${rate / 1_000_000} Mbit/s`
                : `${rate / 1_000} kbit/s`}
            </option>
          ))}
          <option value="custom">自定义…</option>
        </select>
      </div>
      {bitrate === 'custom' && (
        <div className="control-field">
          <label htmlFor="control-custom-bitrate">自定义比特率 (bit/s)</label>
          <input
            id="control-custom-bitrate"
            type="number"
            min={1}
            required
            aria-invalid={customError !== null}
            aria-describedby={
              customError !== null ? 'control-custom-bitrate-error' : undefined
            }
            value={customBitrate}
            onChange={(e) => {
              setCustomBitrate(e.target.value)
              setCustomError(null)
            }}
            disabled={disabled}
          />
          {customError !== null && (
            <p
              id="control-custom-bitrate-error"
              className="control-field-error"
              role="alert"
            >
              {customError}
            </p>
          )}
        </div>
      )}
      <div className="control-field">
        <label htmlFor="control-threshold">判决阈值 (mV)</label>
        <input
          id="control-threshold"
          type="number"
          placeholder={settings.thresholdMv.toFixed(0)}
          value={threshold}
          onChange={(e) => setThreshold(e.target.value)}
          disabled={disabled}
        />
      </div>
      <div className="control-field">
        <label htmlFor="control-hysteresis">滞回带 (mV)</label>
        <input
          id="control-hysteresis"
          type="number"
          min={0}
          placeholder={settings.hysteresisMv.toFixed(0)}
          value={hysteresis}
          onChange={(e) => setHysteresis(e.target.value)}
          disabled={disabled}
        />
      </div>
      <div className="control-field">
        <label htmlFor="control-polarity">极性</label>
        <select
          id="control-polarity"
          value={polarity}
          onChange={(e) => setPolarity(e.target.value)}
          disabled={disabled}
        >
          <option value="auto">自动（解码成功率确认）</option>
          <option value="normal">正常</option>
          <option value="invert">反转</option>
        </select>
      </div>
      <button type="submit" disabled={disabled}>
        重新分析
      </button>
    </form>
  )
}
