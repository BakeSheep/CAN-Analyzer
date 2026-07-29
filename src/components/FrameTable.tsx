import { useMemo, useState, type ReactNode } from 'react'
import { useI18n } from '../app/i18n'
import type { CanFrame } from '../core/types'

interface FrameTableProps {
  frames: CanFrame[]
  selectedIndex: number | null
  onSelect: (index: number) => void
  /** For displaying start times; defaults to 1 (raw sample indexes). */
  sampleRateHz?: number
  /** Extra toolbar content (e.g. export buttons), top-right of the card. */
  actions?: ReactNode
  /** No CSV imported yet: keep the card visible, show dashes. */
  placeholder?: boolean
}

export function frameStatus(frame: CanFrame): 'ok' | 'error' {
  return frame.errors.length === 0 && frame.crcValid ? 'ok' : 'error'
}

export function formatDataHex(data: Uint8Array): string {
  return Array.from(data)
    .map((byte) => byte.toString(16).toUpperCase().padStart(2, '0'))
    .join(' ')
}

/** Decoded frame list with ID/status filtering and row selection. */
export function FrameTable({
  frames,
  selectedIndex,
  onSelect,
  sampleRateHz = 1,
  actions,
  placeholder = false,
}: FrameTableProps) {
  const { t } = useI18n()
  const [idFilter, setIdFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'ok' | 'error'>(
    'all',
  )

  const visible = useMemo(() => {
    const needle = idFilter.trim().toUpperCase()
    return frames.filter((frame) => {
      if (needle !== '' && !frame.idHex.includes(needle)) return false
      if (statusFilter !== 'all' && frameStatus(frame) !== statusFilter) {
        return false
      }
      return true
    })
  }, [frames, idFilter, statusFilter])

  return (
    <section aria-label={t('table.aria')} className="frame-table">
      <div className="frame-table-filters">
        <div className="control-field">
          <label htmlFor="frame-filter-id">{t('table.filterId')}</label>
          <input
            id="frame-filter-id"
            type="text"
            value={idFilter}
            onChange={(e) => setIdFilter(e.target.value)}
            placeholder={t('table.filterIdPlaceholder')}
            disabled={placeholder}
          />
        </div>
        <div className="control-field">
          <label htmlFor="frame-filter-status">{t('table.filterStatus')}</label>
          <select
            id="frame-filter-status"
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as 'all' | 'ok' | 'error')
            }
            disabled={placeholder}
          >
            <option value="all">{t('table.all')}</option>
            <option value="ok">{t('table.ok')}</option>
            <option value="error">{t('table.error')}</option>
          </select>
        </div>
        <p className="frame-table-count">
          {placeholder
            ? t('table.count', { visible: '-', total: '-' })
            : t('table.count', {
                visible: visible.length,
                total: frames.length,
              })}
        </p>
        {actions !== undefined && (
          <div className="frame-table-actions">{actions}</div>
        )}
      </div>
      {placeholder ? (
        <p className="frame-table-empty">-</p>
      ) : visible.length === 0 ? (
        <p className="frame-table-empty">
          {frames.length === 0
            ? t('table.emptyNoFrames')
            : t('table.emptyNoMatch')}
        </p>
      ) : (
        <div
          className="frame-table-scroll"
          role="region"
          aria-label={t('table.dataAria')}
        >
          <table>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">{t('table.colStart')}</th>
                <th scope="col">ID</th>
                <th scope="col">{t('table.colFormat')}</th>
                <th scope="col">{t('table.colType')}</th>
                <th scope="col">DLC</th>
                <th scope="col">{t('table.colData')}</th>
                <th scope="col">CRC</th>
                <th scope="col">ACK</th>
                <th scope="col">{t('table.colStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((frame) => (
                <tr
                  key={frame.index}
                  tabIndex={0}
                  aria-selected={frame.index === selectedIndex}
                  className={
                    frame.index === selectedIndex ? 'selected' : undefined
                  }
                  onClick={() => onSelect(frame.index)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onSelect(frame.index)
                    }
                  }}
                >
                  <td>{frame.index}</td>
                  <td className="mono">
                    {((frame.startSample / sampleRateHz) * 1e3).toFixed(4)} ms
                  </td>
                  <td className="mono">{frame.idHex}</td>
                  <td>
                    {frame.format === 'extended'
                      ? t('table.extended')
                      : t('table.standard')}
                  </td>
                  <td>{frame.rtr ? t('table.remote') : t('table.dataFrame')}</td>
                  <td>{frame.dlc}</td>
                  <td className="mono">{formatDataHex(frame.data)}</td>
                  <td className="mono">
                    {frame.crc.toString(16).toUpperCase().padStart(4, '0')}
                    {frame.crcValid ? ' ✓' : ' ✗'}
                  </td>
                  <td>{frame.acknowledged ? t('table.ackYes') : t('table.ackNo')}</td>
                  <td
                    className={
                      frameStatus(frame) === 'ok'
                        ? 'status-ok'
                        : 'status-error'
                    }
                  >
                    {frameStatus(frame) === 'ok'
                      ? t('table.statusOk')
                      : `✗ ${frame.errors[0]?.code ?? t('table.errorFallback')}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
