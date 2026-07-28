import {
  AnalysisCancelledError,
  analyzeCaptureText,
} from '../../src/workers/analysisPipeline'
import { ScopeCsvParseError } from '../../src/core/csvParser'
import type { AnalysisPhase } from '../../src/workers/protocol'
import { encodeFrameBits } from '../fixtures/canFrames'
import { makeSyntheticCapture } from '../fixtures/makeCapture'

const SAMPLE_RATE = 5_000_000
const BITRATE = 500_000

/** Render an encoded frame into oscilloscope CSV text. */
function captureCsv(bits: Array<0 | 1>): string {
  const capture = makeSyntheticCapture({
    bits,
    bitrateBps: BITRATE,
    sampleRateHz: SAMPLE_RATE,
    noiseMv: 40,
    seed: 5,
  })
  const lines = [`CH(mV)  probe:X1,sampling rate : ${SAMPLE_RATE}`]
  for (const v of capture.samples) lines.push(v.toFixed(2))
  return lines.join('\r\n')
}

describe('analyzeCaptureText pipeline', () => {
  const frameBits = encodeFrameBits({ id: 0x2b3, data: [0x11, 0x22, 0x33] })
  const csv = captureCsv(frameBits)

  it('runs parse → quantize → detect → decode and reports every phase', () => {
    const phases: AnalysisPhase[] = []
    const output = analyzeCaptureText(csv, {}, {
      onPhase: (phase) => {
        if (phases.at(-1) !== phase) phases.push(phase)
      },
    })

    expect(phases).toEqual([
      'reading',
      'quantizing',
      'detecting-bitrate',
      'decoding',
    ])

    const { result, overview } = output
    expect(result.metadata.sampleRateHz).toBe(SAMPLE_RATE)
    expect(result.settings.bitrateBps).toBe(BITRATE)
    expect(result.settings.manualBitrate).toBe(false)
    expect(result.bitrate.reliable).toBe(true)

    expect(result.frames).toHaveLength(1)
    const frame = result.frames[0]
    expect(frame.id).toBe(0x2b3)
    expect(Array.from(frame.data)).toEqual([0x11, 0x22, 0x33])
    expect(frame.crcValid).toBe(true)
    expect(frame.acknowledged).toBe(true)
    expect(frame.startSample).toBeGreaterThan(0)
    expect(frame.endSample).toBeLessThanOrEqual(result.metadata.sampleCount)

    expect(overview.min.length).toBe(overview.max.length)
    expect(overview.bucketStart.length).toBe(overview.min.length)
    expect(overview.sampleCount).toBe(result.metadata.sampleCount)
    expect(overview.bucketSize).toBeGreaterThanOrEqual(1)
  })

  it('confirms polarity by decode success when idle evidence is absent', () => {
    // Inverted voltage mapping: dominant becomes the HIGH voltage.
    const capture = makeSyntheticCapture({
      bits: frameBits,
      bitrateBps: BITRATE,
      sampleRateHz: SAMPLE_RATE,
      invert: true,
    })
    const lines = [`CH(mV)  probe:X1,sampling rate : ${SAMPLE_RATE}`]
    for (const v of capture.samples) lines.push(v.toFixed(2))
    const { result } = analyzeCaptureText(lines.join('\n'), {})
    expect(result.frames).toHaveLength(1)
    expect(result.frames[0].id).toBe(0x2b3)
    expect(result.frames[0].crcValid).toBe(true)
  })

  it('honors a manual bitrate even when it decodes nothing', () => {
    const { result } = analyzeCaptureText(csv, { bitrateBps: 125_000 })
    expect(result.settings.bitrateBps).toBe(125_000)
    expect(result.settings.manualBitrate).toBe(true)
    // No frames decodable at the wrong rate, but no crash either.
    expect(result.frames).toHaveLength(0)
  })

  it('supports cancellation between phases', () => {
    let phaseCount = 0
    expect(() =>
      analyzeCaptureText(csv, {}, {
        onPhase: () => {
          phaseCount += 1
        },
        shouldCancel: () => phaseCount > 1,
      }),
    ).toThrowError(AnalysisCancelledError)
  })

  it('propagates parse errors with line information', () => {
    expect(() => analyzeCaptureText('not a scope file\n1\n2\n', {})).toThrowError(
      ScopeCsvParseError,
    )
  })

  it('rejects captures whose sample rate is too low for the manual bitrate', () => {
    expect(() =>
      analyzeCaptureText(csv, { bitrateBps: 2_000_000 }),
    ).toThrowError(/样本/)
  })
})
