import { framesToCsv, framesToJson } from '../../src/core/exporters'
import type { AnalysisResult, CanFrame } from '../../src/core/types'

function makeFrame(overrides: Partial<CanFrame> = {}): CanFrame {
  return {
    index: 0,
    startSample: 5000,
    endSample: 10000,
    format: 'standard',
    id: 0x123,
    idHex: '123',
    rtr: false,
    dlc: 2,
    data: new Uint8Array([0xab, 0xcd]),
    crc: 0x1234,
    crcValid: true,
    acknowledged: true,
    errors: [],
    fields: [],
    ...overrides,
  }
}

function makeResult(frames: CanFrame[]): AnalysisResult {
  return {
    metadata: {
      sampleRateHz: 50_000_000,
      unit: 'mV',
      probe: 'X1',
      sampleCount: 64_080,
      min: -2323,
      max: 108,
    },
    levels: {
      lowLevel: -2220,
      highLevel: 0,
      threshold: -1110,
      hysteresis: 222,
      noiseEstimate: 20,
      confidence: 0.95,
    },
    settings: {
      thresholdMv: -1110,
      hysteresisMv: 222,
      dominantIsLow: true,
      bitrateBps: 500_000,
      invertPolarity: false,
      manualBitrate: false,
    },
    bitrate: { candidates: [], reliable: true, warnings: [] },
    frames,
    errors: [],
    warnings: [],
  }
}

describe('framesToJson', () => {
  it('is deterministic and puts metadata and settings before frames', () => {
    const result = makeResult([makeFrame()])
    const a = framesToJson(result, result.frames)
    const b = framesToJson(result, result.frames)
    expect(a).toBe(b)
    const parsed = JSON.parse(a)
    expect(Object.keys(parsed)).toEqual([
      'tool',
      'metadata',
      'settings',
      'warnings',
      'frames',
      'captureErrors',
    ])
    expect(a.indexOf('"metadata"')).toBeLessThan(a.indexOf('"frames"'))
    expect(a.indexOf('"settings"')).toBeLessThan(a.indexOf('"frames"'))
  })

  it('serializes frames with hex id, byte array, and seconds', () => {
    const result = makeResult([makeFrame()])
    const parsed = JSON.parse(framesToJson(result, result.frames))
    const frame = parsed.frames[0]
    expect(frame.idHex).toBe('123')
    expect(frame.data).toEqual([0xab, 0xcd])
    expect(frame.startTimeS).toBeCloseTo(5000 / 50_000_000, 12)
    expect(frame.endTimeS).toBeCloseTo(10000 / 50_000_000, 12)
    expect(frame.crcValid).toBe(true)
  })
})

describe('framesToCsv', () => {
  it('emits the exact column header and RFC 4180 CRLF line endings', () => {
    const csv = framesToCsv([makeFrame()], 50_000_000)
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe(
      'index,start_time_s,end_time_s,id,format,type,dlc,data,crc,crc_valid,acknowledged,status,errors',
    )
    expect(lines).toHaveLength(3) // header + row + trailing CRLF
    expect(lines[2]).toBe('')
  })

  it('writes one well-formed row per frame', () => {
    const csv = framesToCsv([makeFrame()], 50_000_000)
    const row = csv.split('\r\n')[1].split(',')
    expect(row[0]).toBe('0')
    expect(Number(row[1])).toBeCloseTo(0.0001, 9)
    expect(row[3]).toBe('123')
    expect(row[4]).toBe('standard')
    expect(row[5]).toBe('data')
    expect(row[6]).toBe('2')
    expect(row[7]).toBe('AB CD')
    expect(row[8]).toBe('1234')
    expect(row[9]).toBe('true')
    expect(row[10]).toBe('true')
    expect(row[11]).toBe('ok')
  })

  it('quotes fields containing commas or quotes per RFC 4180', () => {
    const frame = makeFrame({
      crcValid: false,
      errors: [
        {
          code: 'crc-mismatch',
          message: 'CRC failed, expected "0x1235"',
          startSample: 1,
          endSample: 2,
        },
      ],
    })
    const csv = framesToCsv([frame], 50_000_000)
    const dataLine = csv.split('\r\n')[1]
    expect(dataLine).toContain('"crc-mismatch: CRC failed, expected ""0x1235"""')
  })

  it('prefixes cells starting with =, +, - or @ to block formula injection', () => {
    for (const risky of ['=', '+', '-', '@']) {
      // Craft a frame whose rendered cell would begin with the risky
      // character (e.g. a hostile idHex string).
      const injected = framesToCsv(
        [makeFrame({ idHex: `${risky}HYPERLINK("http://evil")` })],
        50_000_000,
      )
      const dataLine = injected.split('\r\n')[1]
      // The cell must be neutralized with a leading single quote…
      expect(dataLine).toContain(`'${risky}HYPERLINK`)
      // …so no cell in the row starts with a bare formula trigger.
      const cells = dataLine.split(',')
      for (const cell of cells) {
        const unquoted = cell.startsWith('"') ? cell.slice(1) : cell
        expect(unquoted.startsWith(risky)).toBe(false)
      }
    }
  })

  it('exports an empty table as just the header', () => {
    expect(framesToCsv([], 50_000_000)).toBe(
      'index,start_time_s,end_time_s,id,format,type,dlc,data,crc,crc_valid,acknowledged,status,errors\r\n',
    )
  })
})
