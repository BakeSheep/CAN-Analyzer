import { useState, type FormEvent } from 'react'
import { useI18n } from '../app/i18n'
import { COMMON_BITRATES } from '../core/bitrateDetector'
import type { AnalysisSettings } from '../core/types'
import type { AnalyzeSettings } from '../workers/protocol'

interface AnalyzerControlsProps {
  /** `null` before any CSV has been imported (placeholder mode). */
  settings: AnalysisSettings | null
  onApply: (overrides: AnalyzeSettings) => void
  disabled: boolean
}

/** Manual overrides: bitrate, threshold, hysteresis, and polarity. */
export function AnalyzerControls({
  settings,
  onApply,
  disabled,
}: AnalyzerControlsProps) {
  const { t } = useI18n()
  const [bitrate, setBitrate] = useState<string>('auto')
  const [customBitrate, setCustomBitrate] = useState<string>('')
  const [customError, setCustomError] = useState<string | null>(null)
  const [threshold, setThreshold] = useState<string>('')
  const [thresholdError, setThresholdError] = useState<string | null>(null)
  const [hysteresis, setHysteresis] = useState<string>('')
  const [hysteresisError, setHysteresisError] = useState<string | null>(null)
  const [polarity, setPolarity] = useState<string>('auto')

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    const overrides: AnalyzeSettings = {}
    let invalid = false
    if (bitrate === 'custom') {
      const parsed = Number(customBitrate)
      if (customBitrate.trim() === '' || !Number.isFinite(parsed) || parsed <= 0) {
        // Never silently fall back to auto detection: block the submit
        // and surface a field-level error instead.
        setCustomError(t('controls.customBitrateError'))
        invalid = true
      } else {
        setCustomError(null)
        overrides.bitrateBps = parsed
      }
    } else if (bitrate !== 'auto') {
      overrides.bitrateBps = Number(bitrate)
    }
    if (threshold.trim() !== '') {
      const parsed = Number(threshold)
      if (!Number.isFinite(parsed)) {
        setThresholdError(t('controls.thresholdError'))
        invalid = true
      } else {
        setThresholdError(null)
        overrides.thresholdMv = parsed
      }
    }
    if (hysteresis.trim() !== '') {
      const parsed = Number(hysteresis)
      if (!Number.isFinite(parsed) || parsed < 0) {
        // A negative or non-finite band must block the submit, not be
        // silently dropped while the analysis still runs.
        setHysteresisError(t('controls.hysteresisError'))
        invalid = true
      } else {
        setHysteresisError(null)
        overrides.hysteresisMv = parsed
      }
    }
    if (invalid) return
    if (polarity === 'invert') overrides.invertPolarity = true
    else if (polarity === 'normal') overrides.invertPolarity = false
    onApply(overrides)
  }

  return (
    <form
      className="analyzer-controls"
      aria-label={t('controls.aria')}
      noValidate
      onSubmit={handleSubmit}
    >
      <div className="control-field">
        <label htmlFor="control-bitrate">{t('controls.bitrate')}</label>
        <select
          id="control-bitrate"
          value={bitrate}
          onChange={(e) => setBitrate(e.target.value)}
          disabled={disabled}
        >
          <option value="auto">
            {t('controls.autoDetect', {
              current: settings?.bitrateBps ?? '-',
            })}
          </option>
          {COMMON_BITRATES.map((rate) => (
            <option key={rate} value={rate}>
              {rate >= 1_000_000
                ? `${rate / 1_000_000} Mbit/s`
                : `${rate / 1_000} kbit/s`}
            </option>
          ))}
          <option value="custom">{t('controls.custom')}</option>
        </select>
      </div>
      {bitrate === 'custom' && (
        <div className="control-field">
          <label htmlFor="control-custom-bitrate">
            {t('controls.customBitrate')}
          </label>
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
        <label htmlFor="control-threshold">{t('controls.threshold')}</label>
        <input
          id="control-threshold"
          type="number"
          placeholder={settings?.thresholdMv.toFixed(0) ?? '-'}
          aria-invalid={thresholdError !== null}
          aria-describedby={
            thresholdError !== null ? 'control-threshold-error' : undefined
          }
          value={threshold}
          onChange={(e) => {
            setThreshold(e.target.value)
            setThresholdError(null)
          }}
          disabled={disabled}
        />
        {thresholdError !== null && (
          <p
            id="control-threshold-error"
            className="control-field-error"
            role="alert"
          >
            {thresholdError}
          </p>
        )}
      </div>
      <div className="control-field">
        <label htmlFor="control-hysteresis">{t('controls.hysteresis')}</label>
        <input
          id="control-hysteresis"
          type="number"
          min={0}
          placeholder={settings?.hysteresisMv.toFixed(0) ?? '-'}
          aria-invalid={hysteresisError !== null}
          aria-describedby={
            hysteresisError !== null ? 'control-hysteresis-error' : undefined
          }
          value={hysteresis}
          onChange={(e) => {
            setHysteresis(e.target.value)
            setHysteresisError(null)
          }}
          disabled={disabled}
        />
        {hysteresisError !== null && (
          <p
            id="control-hysteresis-error"
            className="control-field-error"
            role="alert"
          >
            {hysteresisError}
          </p>
        )}
      </div>
      <div className="control-field">
        <label htmlFor="control-polarity">{t('controls.polarity')}</label>
        <select
          id="control-polarity"
          value={polarity}
          onChange={(e) => setPolarity(e.target.value)}
          disabled={disabled}
        >
          <option value="auto">{t('controls.polarityAuto')}</option>
          <option value="normal">{t('controls.polarityNormal')}</option>
          <option value="invert">{t('controls.polarityInvert')}</option>
        </select>
      </div>
      <button type="submit" disabled={disabled}>
        {t('controls.reanalyze')}
      </button>
    </form>
  )
}
