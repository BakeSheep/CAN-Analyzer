import type { CanFrame } from '../core/types'

interface FrameTimelineProps {
  frames: CanFrame[]
  sampleCount: number
  sampleRateHz: number
  selectedIndex: number | null
  onSelect: (index: number) => void
}

const TICK_COUNT = 6

type TimelineStatus = 'ack' | 'noack' | 'error'

function timelineStatus(frame: CanFrame): TimelineStatus {
  if (frame.errors.length > 0 || !frame.crcValid) return 'error'
  return frame.acknowledged ? 'ack' : 'noack'
}

const STATUS_LABEL: Record<TimelineStatus, string> = {
  ack: '已应答',
  noack: '无应答',
  error: '错误',
}

/**
 * Compact frame timeline under the waveform: a time axis with tick labels
 * and one clickable block per frame, colored by ACK/error status
 * (green = acknowledged, blue = no ACK, red = error).
 */
export function FrameTimeline({
  frames,
  sampleCount,
  sampleRateHz,
  selectedIndex,
  onSelect,
}: FrameTimelineProps) {
  if (sampleCount <= 0) return null
  const totalMs = (sampleCount / sampleRateHz) * 1e3
  const toPercent = (sample: number) => (sample / sampleCount) * 100

  const ticks = Array.from({ length: TICK_COUNT + 1 }, (_, i) => {
    const fraction = i / TICK_COUNT
    return { left: fraction * 100, label: (totalMs * fraction).toFixed(3) }
  })

  return (
    <div className="frame-timeline" aria-label="帧时间轴">
      <div className="frame-timeline-track">
        {frames.map((frame) => {
          const status = timelineStatus(frame)
          const left = toPercent(frame.startSample)
          const width = Math.max(
            toPercent(frame.endSample) - left,
            0.4,
          )
          const startMs = ((frame.startSample / sampleRateHz) * 1e3).toFixed(4)
          return (
            <button
              key={frame.index}
              type="button"
              className={`frame-timeline-block ${status}${
                frame.index === selectedIndex ? ' selected' : ''
              }`}
              style={{ left: `${left}%`, width: `${width}%` }}
              title={`帧 #${frame.index} · ID 0x${frame.idHex} · ${startMs} ms · ${STATUS_LABEL[status]}`}
              aria-label={`帧 ${frame.index}，ID 0x${frame.idHex}，${startMs} 毫秒，${STATUS_LABEL[status]}`}
              onClick={() => onSelect(frame.index)}
            />
          )
        })}
      </div>
      {/* Frame IDs sit between the axis line and its tick numbers,
          center-aligned with each frame's position on the axis. */}
      <div className="frame-timeline-ids">
        {frames.map((frame) => {
          const center =
            (toPercent(frame.startSample) + toPercent(frame.endSample)) / 2
          return (
            <span
              key={frame.index}
              className={`frame-timeline-id ${timelineStatus(frame)}`}
              style={{ left: `${center}%` }}
            >
              0x{frame.idHex}
            </span>
          )
        })}
      </div>
      <div className="frame-timeline-axis">
        {ticks.map((tick) => (
          <span
            key={tick.label}
            className="frame-timeline-tick"
            style={{ left: `${tick.left}%` }}
          >
            {tick.label} ms
          </span>
        ))}
      </div>
      <p className="frame-timeline-legend">
        <span className="legend-swatch ack" aria-hidden="true" /> 已应答
        <span className="legend-swatch noack" aria-hidden="true" /> 无应答
        <span className="legend-swatch error" aria-hidden="true" /> 错误
      </p>
    </div>
  )
}
