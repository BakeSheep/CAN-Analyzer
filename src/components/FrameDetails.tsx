import type { CanFieldName, CanFrame } from '../core/types'
import { formatDataHex } from './FrameTable'

interface FrameDetailsProps {
  frame: CanFrame | null
  sampleRateHz: number
}

const FIELD_LABELS: Record<CanFieldName, string> = {
  sof: 'SOF（帧起始）',
  arbitration: '仲裁段',
  control: '控制段',
  data: '数据段',
  crc: 'CRC 段',
  ack: 'ACK 段',
  eof: 'EOF（帧结束）',
}

/** Field spans, payload, and error list for the selected frame. */
export function FrameDetails({ frame, sampleRateHz }: FrameDetailsProps) {
  if (frame === null) {
    return (
      <section
        aria-label="帧详情"
        className="frame-details"
        data-testid="frame-details"
      >
        <p className="frame-details-empty">在表格或波形中选择一个帧查看详情。</p>
      </section>
    )
  }

  const toMs = (sample: number) => ((sample / sampleRateHz) * 1e3).toFixed(4)

  return (
    <section
      aria-label="帧详情"
      className="frame-details"
      data-testid="frame-details"
    >
      <h3>
        帧 #{frame.index} · ID {frame.idHex} ·{' '}
        {frame.format === 'extended' ? '扩展' : '标准'}
        {frame.rtr ? '远程帧' : '数据帧'}
      </h3>
      <dl className="frame-details-grid">
        <div>
          <dt>时间范围</dt>
          <dd className="mono">
            {toMs(frame.startSample)} – {toMs(frame.endSample)} ms
          </dd>
        </div>
        <div>
          <dt>DLC</dt>
          <dd>{frame.dlc}</dd>
        </div>
        <div>
          <dt>数据</dt>
          <dd className="mono">
            {frame.data.length > 0 ? formatDataHex(frame.data) : '（无）'}
          </dd>
        </div>
        <div>
          <dt>CRC</dt>
          <dd className="mono">
            0x{frame.crc.toString(16).toUpperCase().padStart(4, '0')}{' '}
            {frame.crcValid ? '✓ 校验通过' : '✗ 校验失败'}
          </dd>
        </div>
        <div>
          <dt>ACK</dt>
          <dd>{frame.acknowledged ? '✓ 已应答' : '✗ 无应答'}</dd>
        </div>
      </dl>

      <h4>字段区间</h4>
      <table className="frame-details-fields">
        <thead>
          <tr>
            <th scope="col">字段</th>
            <th scope="col">起始 (ms)</th>
            <th scope="col">结束 (ms)</th>
            <th scope="col">样本区间</th>
          </tr>
        </thead>
        <tbody>
          {frame.fields.map((span) => (
            <tr key={span.field}>
              <td>{FIELD_LABELS[span.field]}</td>
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
          <h4>帧错误</h4>
          <ul className="frame-details-errors">
            {frame.errors.map((error) => (
              <li key={`${error.code}-${error.startSample}`}>
                <strong>{error.code}</strong>：{error.message}（样本{' '}
                {error.startSample} – {error.endSample}）
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
