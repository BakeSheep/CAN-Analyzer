import { useMemo, useState, type ReactNode } from 'react'
import type { CanFrame } from '../core/types'

interface FrameTableProps {
  frames: CanFrame[]
  selectedIndex: number | null
  onSelect: (index: number) => void
  /** For displaying start times; defaults to 1 (raw sample indexes). */
  sampleRateHz?: number
  /** Extra toolbar content (e.g. export buttons), top-right of the card. */
  actions?: ReactNode
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
}: FrameTableProps) {
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
    <section aria-label="解码帧列表" className="frame-table">
      <div className="frame-table-filters">
        <div className="control-field">
          <label htmlFor="frame-filter-id">按 ID 过滤（HEX）</label>
          <input
            id="frame-filter-id"
            type="text"
            value={idFilter}
            onChange={(e) => setIdFilter(e.target.value)}
            placeholder="如 123"
          />
        </div>
        <div className="control-field">
          <label htmlFor="frame-filter-status">按状态过滤</label>
          <select
            id="frame-filter-status"
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as 'all' | 'ok' | 'error')
            }
          >
            <option value="all">全部</option>
            <option value="ok">正常</option>
            <option value="error">错误</option>
          </select>
        </div>
        <p className="frame-table-count">
          {visible.length} / {frames.length} 帧
        </p>
        {actions !== undefined && (
          <div className="frame-table-actions">{actions}</div>
        )}
      </div>
      {visible.length === 0 ? (
        <p className="frame-table-empty">
          {frames.length === 0
            ? '未解码出任何帧。请检查比特率、极性与阈值设置。'
            : '没有匹配当前过滤条件的帧。'}
        </p>
      ) : (
        <div className="frame-table-scroll" role="region" aria-label="帧数据">
          <table>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">起始时间</th>
                <th scope="col">ID</th>
                <th scope="col">格式</th>
                <th scope="col">类型</th>
                <th scope="col">DLC</th>
                <th scope="col">数据</th>
                <th scope="col">CRC</th>
                <th scope="col">ACK</th>
                <th scope="col">状态</th>
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
                  <td>{frame.format === 'extended' ? '扩展' : '标准'}</td>
                  <td>{frame.rtr ? '远程' : '数据'}</td>
                  <td>{frame.dlc}</td>
                  <td className="mono">{formatDataHex(frame.data)}</td>
                  <td className="mono">
                    {frame.crc.toString(16).toUpperCase().padStart(4, '0')}
                    {frame.crcValid ? ' ✓' : ' ✗'}
                  </td>
                  <td>{frame.acknowledged ? '有' : '无'}</td>
                  <td
                    className={
                      frameStatus(frame) === 'ok'
                        ? 'status-ok'
                        : 'status-error'
                    }
                  >
                    {frameStatus(frame) === 'ok'
                      ? '✓ 正常'
                      : `✗ ${frame.errors[0]?.code ?? '错误'}`}
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
