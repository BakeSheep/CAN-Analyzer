import { useEffect, useMemo, useRef } from 'react'
import uPlot from 'uplot'
import { useI18n } from '../app/i18n'
import type { CanFrame, SignalLevels } from '../core/types'
import type { DigitalSeries, OverviewSeries } from '../workers/protocol'

interface WaveformChartProps {
  /** `null` before any CSV has been imported (placeholder mode). */
  overview: OverviewSeries | null
  digital: DigitalSeries | null
  frames: CanFrame[]
  selectedIndex: number | null
  onSelectFrame: (index: number) => void
  sampleRateHz: number
  unit: string
  threshold: number
  levels: SignalLevels | null
}

const FRAME_OK_COLOR = 'rgba(11, 95, 165, 0.18)'
const FRAME_ERROR_COLOR = 'rgba(179, 38, 30, 0.22)'
const FRAME_SELECTED_COLOR = 'rgba(11, 95, 165, 0.38)'
/** Skip the exact overlay when more runs than this are visible. */
const MAX_VISIBLE_RUNS = 4000
/** Frame strip between the x-axis line and its tick numbers (CSS px). */
const STRIP_TOP_CSS = 3
const STRIP_HEIGHT_CSS = 14

type StripStatus = 'ack' | 'noack' | 'error'

function stripStatus(frame: CanFrame): StripStatus {
  if (frame.errors.length > 0 || !frame.crcValid) return 'error'
  return frame.acknowledged ? 'ack' : 'noack'
}

const STRIP_COLORS: Record<StripStatus, string> = {
  ack: '#1a6b3c',
  noack: '#0b5fa5',
  error: '#b3261e',
}

/** Unpadded hex label, e.g. 0x100 instead of 0x00000100. */
function frameIdLabel(frame: CanFrame): string {
  return `0x${frame.id.toString(16).toUpperCase()}`
}

/**
 * uPlot waveform: decimated min/max envelope, threshold line, and
 * frame-colored overlays. Selecting a frame zooms to its span; clicking
 * inside an overlay selects the frame in the table. At deep zoom the
 * exact run-length digital signal is drawn on top, so bit-level detail
 * stays visible even when one overview bucket outspans a whole frame.
 */
export function WaveformChart({
  overview,
  digital,
  frames,
  selectedIndex,
  onSelectFrame,
  sampleRateHz,
  unit,
  threshold,
  levels,
}: WaveformChartProps) {
  const { t } = useI18n()
  const containerRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)
  const framesRef = useRef(frames)
  const selectedRef = useRef(selectedIndex)
  const onSelectRef = useRef(onSelectFrame)
  framesRef.current = frames
  selectedRef.current = selectedIndex
  onSelectRef.current = onSelectFrame

  const toMs = useMemo(() => {
    const factor = 1e3 / sampleRateHz
    return (sample: number) => sample * factor
  }, [sampleRateHz])

  const data = useMemo((): uPlot.AlignedData => {
    if (overview === null) {
      return [[], [], []] as unknown as uPlot.AlignedData
    }
    const n = overview.bucketStart.length
    const x = new Float64Array(n)
    for (let i = 0; i < n; i += 1) x[i] = toMs(overview.bucketStart[i])
    return [x, overview.min, overview.max] as unknown as uPlot.AlignedData
  }, [overview, toMs])

  useEffect(() => {
    const container = containerRef.current
    if (
      container === null ||
      overview === null ||
      digital === null ||
      levels === null
    ) {
      return
    }

    const msPerSample = 1e3 / sampleRateHz

    /** Exact square wave from the quantized transitions at deep zoom. */
    const drawDigital = (u: uPlot) => {
      const ctx = u.ctx
      if (!ctx) return
      const xMin = u.scales.x.min
      const xMax = u.scales.x.max
      if (xMin == null || xMax == null) return
      const s0 = Math.max(0, Math.floor(xMin / msPerSample))
      const s1 = Math.min(digital.sampleCount, Math.ceil(xMax / msPerSample))
      if (s1 <= s0) return

      const t = digital.transitions
      // Binary search: last run starting at or before s0.
      let lo = 0
      let hi = t.length - 1
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (t[mid] <= s0) lo = mid
        else hi = mid - 1
      }
      // First run starting at or after s1 bounds the visible run count.
      let lo2 = lo
      let hi2 = t.length
      while (lo2 < hi2) {
        const mid = (lo2 + hi2) >> 1
        if (t[mid] < s1) lo2 = mid + 1
        else hi2 = mid
      }
      if (lo2 - lo > MAX_VISIBLE_RUNS) return // envelope is enough here

      const yHigh = u.valToPos(levels.highLevel, 'y', true)
      const yLow = u.valToPos(levels.lowLevel, 'y', true)
      ctx.save()
      ctx.strokeStyle = '#1a6b3c'
      ctx.lineWidth = 1.5 * (window.devicePixelRatio || 1)
      ctx.beginPath()
      let high = lo % 2 === 0 ? digital.initialHigh : !digital.initialHigh
      let started = false
      for (let run = lo; run < Math.min(lo2 + 1, t.length); run += 1) {
        const runStart = Math.max(t[run], s0)
        const runEnd = Math.min(
          run + 1 < t.length ? t[run + 1] : digital.sampleCount,
          s1,
        )
        if (runEnd <= runStart) {
          high = !high
          continue
        }
        const x0 = u.valToPos(runStart * msPerSample, 'x', true)
        const x1 = u.valToPos(runEnd * msPerSample, 'x', true)
        const y = high ? yHigh : yLow
        if (!started) {
          ctx.moveTo(x0, y)
          started = true
        } else {
          ctx.lineTo(x0, y) // vertical edge
        }
        ctx.lineTo(x1, y)
        high = !high
      }
      ctx.stroke()
      ctx.restore()
    }

    const drawOverlays = (u: uPlot) => {
      const ctx = u.ctx
      if (!ctx) return
      const { top, height } = u.bbox
      for (const frame of framesRef.current) {
        const x0 = u.valToPos(toMs(frame.startSample), 'x', true)
        const x1 = u.valToPos(toMs(frame.endSample), 'x', true)
        if (x1 < u.bbox.left || x0 > u.bbox.left + u.bbox.width) continue
        const hasError = frame.errors.length > 0 || !frame.crcValid
        ctx.fillStyle =
          frame.index === selectedRef.current
            ? FRAME_SELECTED_COLOR
            : hasError
              ? FRAME_ERROR_COLOR
              : FRAME_OK_COLOR
        ctx.fillRect(x0, top, Math.max(x1 - x0, 1), height)
      }
      // Threshold line for visual alignment with the quantizer.
      const yThreshold = u.valToPos(threshold, 'y', true)
      ctx.save()
      ctx.strokeStyle = 'rgba(122, 89, 0, 0.8)'
      ctx.setLineDash([6, 4])
      ctx.beginPath()
      ctx.moveTo(u.bbox.left, yThreshold)
      ctx.lineTo(u.bbox.left + u.bbox.width, yThreshold)
      ctx.stroke()
      ctx.restore()
    }

    /**
     * Frame strip drawn directly under the x-axis line, in the gap before
     * the tick numbers, so it stays aligned with the axis at every zoom
     * level. Green = acknowledged, blue = no ACK, red = error.
     */
    const drawFrameStrip = (u: uPlot) => {
      const ctx = u.ctx
      if (!ctx) return
      const dpr = window.devicePixelRatio || 1
      const left = u.bbox.left
      const right = u.bbox.left + u.bbox.width
      const yTop = u.bbox.top + u.bbox.height + STRIP_TOP_CSS * dpr
      const stripHeight = STRIP_HEIGHT_CSS * dpr
      ctx.save()
      ctx.font = `${10 * dpr}px 'Cascadia Mono', Consolas, monospace`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (const frame of framesRef.current) {
        let x0 = u.valToPos(toMs(frame.startSample), 'x', true)
        let x1 = u.valToPos(toMs(frame.endSample), 'x', true)
        if (x1 < left || x0 > right) continue
        x0 = Math.max(x0, left)
        x1 = Math.min(x1, right)
        const status = stripStatus(frame)
        ctx.fillStyle = STRIP_COLORS[status]
        ctx.fillRect(x0, yTop, Math.max(x1 - x0, 2 * dpr), stripHeight)
        if (frame.index === selectedRef.current) {
          ctx.strokeStyle = '#1a1d21'
          ctx.lineWidth = 2 * dpr
          ctx.strokeRect(x0, yTop, Math.max(x1 - x0, 2 * dpr), stripHeight)
        }
        const label = frameIdLabel(frame)
        if (ctx.measureText(label).width <= x1 - x0 - 6 * dpr) {
          ctx.fillStyle = '#ffffff'
          ctx.fillText(label, (x0 + x1) / 2, yTop + stripHeight / 2)
        }
      }
      ctx.restore()
    }

    const options: uPlot.Options = {
      width: container.clientWidth || 800,
      height: 320,
      padding: [8, 8, 0, 0],
      cursor: { drag: { x: true, y: false } },
      scales: { x: { time: false } },
      axes: [
        // Extra gap keeps room for the frame strip between the axis
        // line and the tick numbers.
        { label: t('chart.time'), gap: 26 },
        { label: t('chart.voltage', { unit }) },
      ],
      series: [
        { label: t('chart.time') },
        {
          label: t('chart.min', { unit }),
          stroke: '#0b5fa5',
          width: 1,
        },
        {
          label: t('chart.max', { unit }),
          stroke: '#4b8ecb',
          width: 1,
        },
      ],
      hooks: {
        drawClear: [drawOverlays],
        draw: [drawDigital, drawFrameStrip],
        ready: [
          (u: uPlot) => {
            u.over?.addEventListener('click', (event: MouseEvent) => {
              const rect = u.over.getBoundingClientRect()
              const xVal = u.posToVal(event.clientX - rect.left, 'x')
              const hit = framesRef.current.find(
                (frame) =>
                  toMs(frame.startSample) <= xVal &&
                  xVal <= toMs(frame.endSample),
              )
              if (hit) onSelectRef.current(hit.index)
            })
            // Clicks on the frame strip (below the plot area) also select.
            u.root.addEventListener('click', (event: MouseEvent) => {
              const rect = u.over.getBoundingClientRect()
              if (
                event.clientY <= rect.bottom ||
                event.clientY >
                  rect.bottom + STRIP_TOP_CSS + STRIP_HEIGHT_CSS + 4 ||
                event.clientX < rect.left ||
                event.clientX > rect.right
              ) {
                return
              }
              const xVal = u.posToVal(event.clientX - rect.left, 'x')
              const hit = framesRef.current.find(
                (frame) =>
                  toMs(frame.startSample) <= xVal &&
                  xVal <= toMs(frame.endSample),
              )
              if (hit) onSelectRef.current(hit.index)
            })
          },
        ],
      },
    }

    const plot = new uPlot(options, data, container)
    plotRef.current = plot

    const handleResize = () => {
      plot.setSize({ width: container.clientWidth || 800, height: 320 })
    }
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
      plot.destroy()
      plotRef.current = null
    }
    // Recreate the plot when the underlying capture (or language) changes.
  }, [data, unit, threshold, toMs, digital, levels, sampleRateHz, overview, t])

  // Selecting a frame zooms the chart to its span (with margin).
  useEffect(() => {
    const plot = plotRef.current
    if (plot === null || selectedIndex === null) return
    const frame = frames.find((f) => f.index === selectedIndex)
    if (frame === undefined) return
    const span = frame.endSample - frame.startSample
    const margin = span * 0.25
    plot.setScale('x', {
      min: toMs(frame.startSample - margin),
      max: toMs(frame.endSample + margin),
    })
  }, [selectedIndex, frames, toMs])

  const resetZoom = () => {
    const plot = plotRef.current
    if (plot === null || overview === null) return
    plot.setScale('x', {
      min: 0,
      max: toMs(overview.sampleCount),
    })
  }

  return (
    <section aria-label={t('chart.aria')} className="waveform-chart">
      <div className="waveform-toolbar">
        <button type="button" onClick={resetZoom} disabled={overview === null}>
          {t('chart.resetZoom')}
        </button>
        <p className="waveform-hint">{t('chart.hint')}</p>
        <p className="frame-timeline-legend">
          <span className="legend-swatch ack" aria-hidden="true" />{' '}
          {t('chart.ack')}
          <span className="legend-swatch noack" aria-hidden="true" />{' '}
          {t('chart.noack')}
          <span className="legend-swatch error" aria-hidden="true" />{' '}
          {t('chart.error')}
        </p>
      </div>
      {overview === null ? (
        <div className="waveform-container waveform-placeholder">-</div>
      ) : (
        <div ref={containerRef} className="waveform-container" />
      )}
    </section>
  )
}
