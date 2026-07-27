import { parseScopeCsv, ScopeCsvParseError } from '../../src/core/csvParser'
import { captureDurationSeconds } from '../../src/core/types'
import {
  MESSY_SCOPE_CSV,
  SMALL_SCOPE_CSV,
  SMALL_SCOPE_VALUES,
} from '../fixtures/small-scope'

describe('parseScopeCsv', () => {
  it('parses the exact supplied header pattern', () => {
    const capture = parseScopeCsv(SMALL_SCOPE_CSV)
    expect(capture.metadata.sampleRateHz).toBe(50_000_000)
    expect(capture.metadata.unit).toBe('mV')
    expect(capture.metadata.probe).toBe('X1')
  })

  it('returns samples as Float32Array with count, min, max, duration', () => {
    const capture = parseScopeCsv(SMALL_SCOPE_CSV)
    expect(capture.samples).toBeInstanceOf(Float32Array)
    expect(capture.metadata.sampleCount).toBe(SMALL_SCOPE_VALUES.length)
    expect(capture.samples.length).toBe(SMALL_SCOPE_VALUES.length)
    expect(capture.metadata.min).toBeCloseTo(-2323, 2)
    expect(capture.metadata.max).toBeCloseTo(108, 2)
    expect(captureDurationSeconds(capture)).toBeCloseTo(
      SMALL_SCOPE_VALUES.length / 50_000_000,
      12,
    )
    for (const [i, value] of SMALL_SCOPE_VALUES.entries()) {
      expect(capture.samples[i]).toBeCloseTo(value, 3)
    }
  })

  it('tolerates BOM, CRLF, blank lines, spaces, and scientific notation', () => {
    const capture = parseScopeCsv(MESSY_SCOPE_CSV)
    expect(capture.metadata.sampleRateHz).toBe(50_000_000)
    expect(capture.metadata.probe).toBe('X1')
    expect(capture.metadata.sampleCount).toBe(SMALL_SCOPE_VALUES.length)
    expect(capture.samples[6]).toBeCloseTo(0.001, 6)
    expect(capture.samples[7]).toBeCloseTo(42, 6)
  })

  it('rejects a header without a sampling rate', () => {
    expect(() => parseScopeCsv('CH(mV)  probe:X1\n0\n1\n')).toThrowError(
      ScopeCsvParseError,
    )
    try {
      parseScopeCsv('CH(mV)  probe:X1\n0\n1\n')
    } catch (error) {
      const parseError = error as ScopeCsvParseError
      expect(parseError.line).toBe(1)
      expect(parseError.message).toMatch(/sampling rate/i)
    }
  })

  it('rejects a zero sampling rate', () => {
    expect(() =>
      parseScopeCsv('CH(mV)  probe:X1,sampling rate : 0\n0\n'),
    ).toThrowError(/sampling rate/i)
  })

  it('rejects a nonnumeric sample with its line number', () => {
    const text = 'CH(mV)  probe:X1,sampling rate : 50000000\n0\nabc\n1\n'
    try {
      parseScopeCsv(text)
      expect.unreachable('expected a parse error')
    } catch (error) {
      const parseError = error as ScopeCsvParseError
      expect(parseError).toBeInstanceOf(ScopeCsvParseError)
      expect(parseError.line).toBe(3)
      expect(parseError.message).toMatch(/abc/)
    }
  })

  it('rejects an empty capture with no samples', () => {
    expect(() =>
      parseScopeCsv('CH(mV)  probe:X1,sampling rate : 50000000\n\n'),
    ).toThrowError(/no samples/i)
  })

  it('rejects an entirely empty file', () => {
    expect(() => parseScopeCsv('')).toThrowError(ScopeCsvParseError)
  })

  it('reports progress and finishes at the total', () => {
    const lines = ['CH(mV)  probe:X1,sampling rate : 50000000']
    for (let i = 0; i < 120_000; i += 1) lines.push(String(i % 7))
    const text = lines.join('\n')
    const seen: number[] = []
    let total = 0
    parseScopeCsv(text, (progress) => {
      seen.push(progress.processed)
      total = progress.total
    })
    // Throttled: far fewer reports than samples, but at least start + end.
    expect(seen.length).toBeGreaterThanOrEqual(2)
    expect(seen.length).toBeLessThan(20)
    expect(total).toBe(text.length)
    expect(seen.at(-1)).toBe(text.length)
  })
})
