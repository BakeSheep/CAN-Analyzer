import { useI18n, type MessageKey } from '../app/i18n'
import type { CanFieldName, CanFrame } from '../core/types'
import { formatDataHex } from './FrameTable'

interface FrameDetailsProps {
  frame: CanFrame | null
  sampleRateHz: number
  /** No CSV imported yet: keep the card visible, show a dash. */
  placeholder?: boolean
}

const FIELD_LABEL_KEYS: Record<CanFieldName, MessageKey> = {
  sof: 'field.sof',
  arbitration: 'field.arbitration',
  control: 'field.control',
  data: 'field.data',
  crc: 'field.crc',
  ack: 'field.ack',
  eof: 'field.eof',
}

/** Field spans, payload, and error list for the selected frame. */
export function FrameDetails({
  frame,
  sampleRateHz,
  placeholder = false,
}: FrameDetailsProps) {
  const { t } = useI18n()

  if (frame === null) {
    return (
      <section
        aria-label={t('details.aria')}
        className="frame-details"
        data-testid="frame-details"
      >
        <p className="frame-details-empty">
          {placeholder ? '-' : t('details.empty')}
        </p>
      </section>
    )
  }

  const toMs = (sample: number) => ((sample / sampleRateHz) * 1e3).toFixed(4)

  const kind = frame.format === 'extended'
    ? frame.rtr
      ? t('details.kindExtendedRemote')
      : t('details.kindExtendedData')
    : frame.rtr
      ? t('details.kindStandardRemote')
      : t('details.kindStandardData')

  return (
    <section
      aria-label={t('details.aria')}
      className="frame-details"
      data-testid="frame-details"
    >
      <h3>
        {t('details.heading', {
          index: frame.index,
          id: frame.idHex,
          kind,
        })}
      </h3>
      <dl className="frame-details-grid">
        <div>
          <dt>{t('details.timeRange')}</dt>
          <dd className="mono">
            {toMs(frame.startSample)} – {toMs(frame.endSample)} ms
          </dd>
        </div>
        <div>
          <dt>DLC</dt>
          <dd>{frame.dlc}</dd>
        </div>
        <div>
          <dt>{t('details.data')}</dt>
          <dd className="mono">
            {frame.data.length > 0 ? formatDataHex(frame.data) : t('details.none')}
          </dd>
        </div>
        <div>
          <dt>CRC</dt>
          <dd className="mono">
            0x{frame.crc.toString(16).toUpperCase().padStart(4, '0')}{' '}
            {frame.crcValid ? t('details.crcValid') : t('details.crcInvalid')}
          </dd>
        </div>
        <div>
          <dt>ACK</dt>
          <dd>{frame.acknowledged ? t('details.ackYes') : t('details.ackNo')}</dd>
        </div>
      </dl>

      <h4>{t('details.fieldSpans')}</h4>
      <table className="frame-details-fields">
        <thead>
          <tr>
            <th scope="col">{t('details.colField')}</th>
            <th scope="col">{t('details.colStart')}</th>
            <th scope="col">{t('details.colEnd')}</th>
            <th scope="col">{t('details.colSamples')}</th>
          </tr>
        </thead>
        <tbody>
          {frame.fields.map((span) => (
            <tr key={span.field}>
              <td>{t(FIELD_LABEL_KEYS[span.field])}</td>
              <td className="mono">{toMs(span.startSample)}</td>
              <td className="mono">{toMs(span.endSample)}</td>
              <td className="mono">
                {span.startSample} – {span.endSample}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {frame.errors.length > 0 && (
        <>
          <h4>{t('details.frameErrors')}</h4>
          <ul className="frame-details-errors">
            {frame.errors.map((error) => (
              <li key={`${error.code}-${error.startSample}`}>
                <strong>{error.code}</strong>
                {t('colon')}
                {error.message}
                {t('sampleSpan', {
                  start: error.startSample,
                  end: error.endSample,
                })}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
