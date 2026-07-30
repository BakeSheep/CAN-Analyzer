import { decodeCanFrames } from '../../src/core/canDecoder'
import { quantize } from '../../src/core/quantizer'
import type { QuantizedSignal } from '../../src/core/types'
import { encodeFrameBits, type FrameSpec } from '../fixtures/canFrames'
import { makeSyntheticCapture } from '../fixtures/makeCapture'

const SPB = 10
const SAMPLE_RATE = 5_000_000
const BITRATE = 500_000

/** Render raw frame bits into a clean quantized signal (spb = 10). */
function signalFromBits(
  bits: ReadonlyArray<0 | 1>,
  idleBitsBefore = 12,
  idleBitsAfter = 12,
): QuantizedSignal {
  const capture = makeSyntheticCapture({
    bits: [...bits],
    bitrateBps: BITRATE,
    sampleRateHz: SAMPLE_RATE,
    idleBitsBefore,
    idleBitsAfter,
  })
  // Polarity comes from the bitrate detector in the real pipeline; the
  // fixtures always map dominant to the low voltage cluster.
  return quantize(capture, { dominantIsLow: true })
}

function decodeSpec(spec: FrameSpec) {
  return decodeCanFrames(signalFromBits(encodeFrameBits(spec)), {
    samplesPerBit: SPB,
  })
}

describe('decodeCanFrames', () => {
  it('decodes a standard 11-bit data frame with DLC 0', () => {
    const { frames, errors } = decodeSpec({ id: 0x123, data: [] })
    expect(errors).toHaveLength(0)
    expect(frames).toHaveLength(1)
    const frame = frames[0]
    expect(frame.format).toBe('standard')
    expect(frame.id).toBe(0x123)
    expect(frame.idHex).toBe('123')
    expect(frame.rtr).toBe(false)
    expect(frame.dlc).toBe(0)
    expect(frame.data).toHaveLength(0)
    expect(frame.crcValid).toBe(true)
    expect(frame.acknowledged).toBe(true)
    expect(frame.errors).toHaveLength(0)
  })

  it('decodes a standard data frame with DLC 8 and exact payload', () => {
    const data = [0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef]
    const { frames } = decodeSpec({ id: 0x2aa, data })
    expect(frames).toHaveLength(1)
    expect(frames[0].dlc).toBe(8)
    expect(Array.from(frames[0].data)).toEqual(data)
    expect(frames[0].crcValid).toBe(true)
  })

  it('decodes an extended 29-bit data frame', () => {
    const { frames, errors } = decodeSpec({
      id: 0x18daf110,
      extended: true,
      data: [0xde, 0xad],
    })
    expect(errors).toHaveLength(0)
    expect(frames).toHaveLength(1)
    expect(frames[0].format).toBe('extended')
    expect(frames[0].id).toBe(0x18daf110)
    expect(frames[0].idHex).toBe('18DAF110')
    expect(Array.from(frames[0].data)).toEqual([0xde, 0xad])
    expect(frames[0].crcValid).toBe(true)
  })

  it('decodes standard and extended remote frames', () => {
    const std = decodeSpec({ id: 0x321, rtr: true, dlc: 2 })
    expect(std.frames[0].rtr).toBe(true)
    expect(std.frames[0].dlc).toBe(2)
    expect(std.frames[0].data).toHaveLength(0)
    expect(std.frames[0].crcValid).toBe(true)

    const ext = decodeSpec({ id: 0x1abcdef0, extended: true, rtr: true, dlc: 4 })
    expect(ext.frames[0].format).toBe('extended')
    expect(ext.frames[0].rtr).toBe(true)
    expect(ext.frames[0].dlc).toBe(4)
    expect(ext.frames[0].data).toHaveLength(0)
    expect(ext.frames[0].crcValid).toBe(true)
  })

  it('flags an invalid CRC without dropping the frame', () => {
    const { frames } = decodeSpec({ id: 0x100, data: [0x42], crcXor: 0x0001 })
    expect(frames).toHaveLength(1)
    expect(frames[0].crcValid).toBe(false)
    expect(frames[0].errors.some((e) => e.code === 'crc-mismatch')).toBe(true)
  })

  it('reports ACK absent when the slot stays recessive', () => {
    const { frames } = decodeSpec({ id: 0x100, data: [0x42], ackSlot: 1 })
    expect(frames).toHaveLength(1)
    expect(frames[0].acknowledged).toBe(false)
  })

  it('flags a dominant CRC delimiter', () => {
    const { frames } = decodeSpec({ id: 0x100, data: [0x42], crcDelimiter: 0 })
    expect(frames).toHaveLength(1)
    expect(
      frames[0].errors.some((e) => e.code === 'crc-delimiter-error'),
    ).toBe(true)
  })

  it('consumes a stuff bit inserted after the final CRC sequence bit', () => {
    // For this zero-length frame, ID 0x009 produces a CRC sequence ending
    // in five dominant bits, so the encoder inserts a complementary bit
    // immediately before the fixed-form CRC delimiter.
    const bits = encodeFrameBits({ id: 0x009, data: [] })
    const { frames, errors } = decodeCanFrames(signalFromBits(bits), {
      samplesPerBit: SPB,
    })
    expect(errors).toHaveLength(0)
    expect(frames).toHaveLength(1)
    expect(frames[0].id).toBe(0x009)
    expect(frames[0].crcValid).toBe(true)
    expect(frames[0].acknowledged).toBe(true)
    expect(frames[0].errors).toHaveLength(0)
  })

  it('flags a dominant bit inside EOF', () => {
    const { frames } = decodeSpec({
      id: 0x100,
      data: [0x42],
      eof: [1, 1, 0, 1, 1, 1, 1],
    })
    expect(frames).toHaveLength(1)
    expect(frames[0].errors.some((e) => e.code === 'eof-error')).toBe(true)
  })

  it('flags DLC values above 8 and clamps the payload', () => {
    const data = [1, 2, 3, 4, 5, 6, 7, 8]
    const { frames } = decodeSpec({ id: 0x100, dlc: 12, data })
    expect(frames).toHaveLength(1)
    expect(frames[0].dlc).toBe(12)
    expect(frames[0].data).toHaveLength(8)
    expect(frames[0].errors.some((e) => e.code === 'invalid-dlc')).toBe(true)
  })

  it('raises a stuff error and recovers at the next valid frame', () => {
    // ID 0 yields SOF+5 zeros then a stuff bit; forcing it to 0 creates six
    // consecutive dominant bits.
    const broken = encodeFrameBits({ id: 0, data: [] })
    expect(broken[5]).toBe(1) // sanity: this is the stuff bit
    broken[5] = 0
    const good = encodeFrameBits({ id: 0x2b, data: [0x7f] })
    const stream = [
      ...broken,
      ...Array.from({ length: 12 }, () => 1 as const),
      ...good,
    ]
    const { frames, errors } = decodeCanFrames(signalFromBits(stream), {
      samplesPerBit: SPB,
    })
    expect(errors.some((e) => e.code === 'stuff-error')).toBe(true)
    expect(frames).toHaveLength(1)
    expect(frames[0].id).toBe(0x2b)
    expect(frames[0].crcValid).toBe(true)
  })

  it('ignores short dominant noise before the SOF', () => {
    const good = encodeFrameBits({ id: 0x55, data: [0xaa] })
    const stream = [
      0 as const, // lone dominant glitch, not preceded by enough idle
      ...Array.from({ length: 12 }, () => 1 as const),
      ...good,
    ]
    // No leading idle so the glitch sits right at the capture start.
    const { frames } = decodeCanFrames(signalFromBits(stream, 2), {
      samplesPerBit: SPB,
    })
    expect(frames).toHaveLength(1)
    expect(frames[0].id).toBe(0x55)
  })

  it('decodes a frame whose SOF has less than one idle bit before it', () => {
    // Like a scope trigger firing right at the frame: only 1 recessive bit
    // precedes the SOF, far below the 7-bit idle requirement.
    const bits = encodeFrameBits({
      id: 0x100,
      extended: true,
      data: [0xf3, 0xab, 0x01, 0x00, 0x6b],
    })
    const { frames, errors } = decodeCanFrames(signalFromBits(bits, 1), {
      samplesPerBit: SPB,
    })
    expect(errors).toHaveLength(0)
    expect(frames).toHaveLength(1)
    expect(frames[0].id).toBe(0x100)
    expect(frames[0].format).toBe('extended')
    expect(Array.from(frames[0].data)).toEqual([0xf3, 0xab, 0x01, 0x00, 0x6b])
    expect(frames[0].crcValid).toBe(true)
  })

  it('decodes a frame whose SOF sits exactly at the capture start', () => {
    const bits = encodeFrameBits({ id: 0x2b, data: [0x7f] })
    const { frames, errors } = decodeCanFrames(signalFromBits(bits, 0), {
      samplesPerBit: SPB,
    })
    expect(errors).toHaveLength(0)
    expect(frames).toHaveLength(1)
    expect(frames[0].id).toBe(0x2b)
    expect(frames[0].crcValid).toBe(true)
  })

  it('still decodes later frames after a rejected capture-start guess', () => {
    // Capture begins mid-frame: the tail of a frame is junk that must not
    // become a bogus frame, while the following full frame still decodes.
    const junkTail = encodeFrameBits({ id: 0x5a5, data: [0x11, 0x22] }).slice(
      30,
    )
    const good = encodeFrameBits({ id: 0x321, data: [0x44] })
    const stream = [
      ...junkTail,
      ...Array.from({ length: 12 }, () => 1 as const),
      ...good,
    ]
    const { frames } = decodeCanFrames(signalFromBits(stream, 0), {
      samplesPerBit: SPB,
    })
    expect(frames).toHaveLength(1)
    expect(frames[0].id).toBe(0x321)
    expect(frames[0].crcValid).toBe(true)
  })

  it('reports a truncated final frame', () => {
    const bits = encodeFrameBits({ id: 0x100, data: [0x42] }).slice(0, 20)
    const { frames, errors } = decodeCanFrames(signalFromBits(bits, 12, 0), {
      samplesPerBit: SPB,
    })
    expect(frames).toHaveLength(0)
    expect(errors.some((e) => e.code === 'truncated-frame')).toBe(true)
  })

  it('decodes multiple back-to-back frames with correct spans', () => {
    const a = encodeFrameBits({ id: 0x101, data: [0x11] })
    const b = encodeFrameBits({ id: 0x202, data: [0x22, 0x33] })
    const stream = [
      ...a,
      ...Array.from({ length: 3 }, () => 1 as const), // intermission
      ...b,
    ]
    const { frames } = decodeCanFrames(signalFromBits(stream), {
      samplesPerBit: SPB,
    })
    expect(frames.map((f) => f.id)).toEqual([0x101, 0x202])
    expect(frames[0].endSample).toBeLessThanOrEqual(frames[1].startSample)
    expect(frames[1].index).toBe(1)
  })

  it('exposes field spans covering the whole frame', () => {
    const { frames } = decodeSpec({ id: 0x123, data: [0x42] })
    const frame = frames[0]
    const fieldNames = frame.fields.map((f) => f.field)
    expect(fieldNames).toEqual([
      'sof',
      'arbitration',
      'control',
      'data',
      'crc',
      'ack',
      'eof',
    ])
    // Spans are contiguous and inside the frame span.
    for (let i = 1; i < frame.fields.length; i += 1) {
      expect(frame.fields[i].startSample).toBe(frame.fields[i - 1].endSample)
    }
    expect(frame.fields[0].startSample).toBe(frame.startSample)
    expect(frame.fields.at(-1)?.endSample).toBe(frame.endSample)
  })

  it('supports polarity inversion', () => {
    const bits = encodeFrameBits({ id: 0x77, data: [0x01] })
    const capture = makeSyntheticCapture({
      bits,
      bitrateBps: BITRATE,
      sampleRateHz: SAMPLE_RATE,
    })
    // Quantize with the WRONG polarity, then ask the decoder to invert.
    const wrong = quantize(capture, { dominantIsLow: false })
    const { frames } = decodeCanFrames(wrong, {
      samplesPerBit: SPB,
      invertPolarity: true,
    })
    expect(frames).toHaveLength(1)
    expect(frames[0].id).toBe(0x77)
    expect(frames[0].crcValid).toBe(true)
  })

  it.each([0, -1, 3.99, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid samplesPerBit=%s',
    (samplesPerBit) => {
      const signal = signalFromBits(encodeFrameBits({ id: 0x123, data: [] }))
      expect(() => decodeCanFrames(signal, { samplesPerBit })).toThrowError(
        RangeError,
      )
    },
  )
})
