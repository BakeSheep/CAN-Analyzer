import { useEffect, useMemo, useRef } from 'react'
import uPlot from 'uplot'
import type { CanFrame, SignalLevels } from '../core/types'
import type { DigitalSeries, OverviewSeries } from '../workers/protocol'

interface WaveformChartProps {
  overview: OverviewSeries
  digital: DigitalSeries
  frames: CanFrame[]
  selectedIndex: number | null
  onSelectFrame: (index: number) => void
  sampleRateHz: number
  unit: string
  threshold: number
  levels: SignalLevels
}

const FRAME_OK_COLOR = 'rgba(11, 95, 165, 0.18)'
const FRAME_ERROR_COLOR = 'rgba(179, 38, 30, 0.22)'
const FRAME_SELECTED_COLOR = 'rgba(11, 95, 165, 0.38)'
/** Skip the exact overlay when more runs than this are visible. */
const MAX_VISIBLE_RUNS = 4000

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
    const n = overview.bucketStart.length
    const x = new Float64Array(n)
    for (let i = 0; i < n; i += 1) x[i] = toMs(overview.bucketStart[i])
    return [x, overview.min, overview.max] as unknown as uPlot.AlignedData
  }, [overview, toMs])

  useEffect(() => {
    const container = containerRef.current
    if (container === null) return

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

    const options: uPlot.Options = {
      width: container.clientWidth || 800,
      height: 320,
      padding: [8, 8, 0, 0],
      cursor: { drag: { x: true, y: false } },
      scales: { x: { time: false } },
      axes: [
        { label: `时间 (ms)` },
        { label: `电压 (${unit})` },
      ],
      series: [
        { label: '时间 (ms)' },
        {
          label: `最小值 (${unit})`,
          stroke: '#0b5fa5',
          width: 1,
        },
        {
          label: `最大值 (${unit})`,
          stroke: '#4b8ecb',
          width: 1,
        },
      ],
      hooks: {
        drawClear: [drawOverlays],
        draw: [drawDigital],
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
    // Recreate the plot when the underlying capture changes.
  }, [data, unit, threshold, toMs, digital, levels, sampleRateHz])

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
    if (plot === null) return
    plot.setScale('x', {
      min: 0,
      max: toMs(overview.sampleCount),
    })
  }

  return (
    <section aria-label="波形视图" className="waveform-chart">
      <div className="waveform-toolbar">
        <button type="button" onClick={resetZoom}>
          重置缩放
        </button>
        <p className="waveform-hint">
          拖动框选可缩放；点击帧覆盖区可在表格中定位对应帧。
        </p>
      </div>
      <div ref={containerRef} className="waveform-container" />
    </section>
  )
}
