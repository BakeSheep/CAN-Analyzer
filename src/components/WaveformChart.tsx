import { useEffect, useMemo, useRef } from 'react'
import uPlot from 'uplot'
import type { CanFrame } from '../core/types'
import type { OverviewSeries } from '../workers/protocol'

interface WaveformChartProps {
  overview: OverviewSeries
  frames: CanFrame[]
  selectedIndex: number | null
  onSelectFrame: (index: number) => void
  sampleRateHz: number
  unit: string
  threshold: number
}

const FRAME_OK_COLOR = 'rgba(11, 95, 165, 0.18)'
const FRAME_ERROR_COLOR = 'rgba(179, 38, 30, 0.22)'
const FRAME_SELECTED_COLOR = 'rgba(11, 95, 165, 0.38)'

/**
 * uPlot waveform: decimated min/max envelope, threshold line, and
 * frame-colored overlays. Selecting a frame zooms to its span; clicking
 * inside an overlay selects the frame in the table.
 */
export function WaveformChart({
  overview,
  frames,
  selectedIndex,
  onSelectFrame,
  sampleRateHz,
  unit,
  threshold,
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
  }, [data, unit, threshold, toMs])

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
