import { BitReader, StuffBitError, type RawBit } from './bitReader'
import { computeCanCrc15 } from './canCrc'
import type {
  BitSample,
  CanFieldSpan,
  CanFrame,
  DecodeError,
  QuantizedSignal,
} from './types'

export interface DecodeOptions {
  /** Samples per bit at the selected bitrate. */
  samplesPerBit: number
  /** Flip logic levels so idle becomes recessive (1). */
  invertPolarity?: boolean
}

export interface DecodeOutcome {
  frames: CanFrame[]
  /** Capture-level errors (stuff/truncation) not attached to a frame. */
  errors: DecodeError[]
}

/** Recessive idle bits required before a dominant edge counts as SOF. */
const IDLE_BITS_BEFORE_SOF = 7
/** Upper bound of raw bits in one Classic CAN frame (with stuffing). */
const MAX_FRAME_RAW_BITS = 170

/** Internal signal: the capture ended inside a frame. */
class TruncatedFrame extends Error {
  constructor(readonly lastSample: number) {
    super('capture ended inside a frame')
  }
}

/**
 * Decode Classic CAN 2.0A/2.0B frames from a quantized signal.
 *
 * A frame decode starts at a recessive→dominant edge preceded by at least
 * seven recessive bit times. The capture start is special: preceding idle
 * cannot be observed there (a trigger may fire right at a SOF), so the
 * first dominant region is tried speculatively and kept only when it
 * decodes into a fully valid frame. Validation problems (CRC, delimiters,
 * EOF, DLC) are recorded on the frame; framing violations (stuffing,
 * truncation) become capture-level errors and decoding resumes at the
 * next plausible idle/SOF boundary.
 */
export function decodeCanFrames(
  quantized: QuantizedSignal,
  options: DecodeOptions,
): DecodeOutcome {
  const { samplesPerBit } = options
  if (!Number.isFinite(samplesPerBit) || samplesPerBit < 4) {
    throw new RangeError(
      `samplesPerBit 无效（${samplesPerBit}）：必须是至少为 4 的有限数值。`,
    )
  }
  const invert = options.invertPolarity ?? false
  const { transitions, initialLevel, sampleCount } = quantized

  const levelAt = (pos: number): 0 | 1 => {
    // Binary search: last transition index <= pos.
    let lo = 0
    let hi = transitions.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (transitions[mid] <= pos) lo = mid
      else hi = mid - 1
    }
    const level = ((initialLevel ^ (lo & 1)) & 1) as 0 | 1
    return invert ? ((1 - level) as 0 | 1) : level
  }

  /**
   * SOF candidate at the capture start, where preceding idle cannot be
   * observed: either the capture begins dominant, or the leading recessive
   * run is shorter than the required idle. Returns null when the regular
   * idle-based search already covers the capture start.
   */
  const findCaptureStartSof = (): number | null => {
    if (transitions.length === 0 || sampleCount === 0) return null
    if (levelAt(0) === 0) return 0 // capture begins mid-SOF/dominant
    // Leading recessive run (transitions[0] is always 0).
    const runEnd = transitions.length > 1 ? transitions[1] : sampleCount
    if (runEnd >= sampleCount) return null // no dominant region follows
    if (runEnd >= IDLE_BITS_BEFORE_SOF * samplesPerBit) return null
    return runEnd
  }

  /** Sample index of the next SOF edge at/after `fromSample`, or null. */
  const findNextSof = (fromSample: number): number | null => {
    const idleSamples = IDLE_BITS_BEFORE_SOF * samplesPerBit
    for (let run = 0; run < transitions.length; run += 1) {
      const start = transitions[run]
      const end =
        run + 1 < transitions.length ? transitions[run + 1] : sampleCount
      if (end < fromSample) continue
      if (end >= sampleCount) break // no dominant region follows
      const rawLevel = ((initialLevel ^ (run & 1)) & 1) as 0 | 1
      const level = invert ? ((1 - rawLevel) as 0 | 1) : rawLevel
      if (level !== 1) continue
      if (end - start < idleSamples) continue
      if (end >= fromSample) return end
    }
    return null
  }

  const frames: CanFrame[] = []
  const errors: DecodeError[] = []
  let searchPos = 0
  let frameIndex = 0

  // Speculative decode at the capture start: without idle evidence this
  // is only a guess, so junk (a truncated frame or noise) is discarded
  // silently and only a fully valid frame is kept.
  const startSof = findCaptureStartSof()
  if (startSof !== null) {
    try {
      const frame = decodeOneFrame(startSof, frameIndex)
      if (frame.crcValid && frame.errors.length === 0) {
        frames.push(frame)
        frameIndex += 1
        searchPos = Math.max(frame.endSample, startSof + 1)
      }
    } catch (error) {
      if (
        !(error instanceof StuffBitError) &&
        !(error instanceof TruncatedFrame)
      ) {
        throw error
      }
    }
  }

  while (searchPos < sampleCount) {
    const sof = findNextSof(searchPos)
    if (sof === null) break
    try {
      const frame = decodeOneFrame(sof, frameIndex)
      frames.push(frame)
      frameIndex += 1
      searchPos = Math.max(frame.endSample, sof + 1)
    } catch (error) {
      if (error instanceof StuffBitError) {
        errors.push({
          code: 'stuff-error',
          message: error.message,
          startSample: error.startSample,
          endSample: error.endSample,
          rawBitIndex: error.rawBitIndex,
          logicalBitIndex: error.logicalBitIndex,
        })
        searchPos = Math.max(error.endSample, sof + 1)
      } else if (error instanceof TruncatedFrame) {
        errors.push({
          code: 'truncated-frame',
          message:
            '捕获在帧结束前中断：最后一帧不完整，已忽略其剩余部分。',
          startSample: sof,
          endSample: sampleCount,
        })
        break
      } else {
        throw error
      }
    }
  }

  return { frames, errors }

  function decodeOneFrame(sofSample: number, index: number): CanFrame {
    const available = Math.floor((sampleCount - sofSample) / samplesPerBit)
    const rawCount = Math.min(available, MAX_FRAME_RAW_BITS)
    const rawBits: RawBit[] = new Array(rawCount)
    for (let k = 0; k < rawCount; k += 1) {
      const start = Math.round(sofSample + k * samplesPerBit)
      const end = Math.min(
        Math.round(sofSample + (k + 1) * samplesPerBit),
        sampleCount,
      )
      const pos = Math.min(
        Math.floor(sofSample + (k + 0.75) * samplesPerBit),
        sampleCount - 1,
      )
      rawBits[k] = { value: levelAt(pos), startSample: start, endSample: end }
    }

    const reader = new BitReader(rawBits)
    const frameErrors: DecodeError[] = []
    /** De-stuffed values from SOF up to the last bit before the CRC. */
    const crcInput: Array<0 | 1> = []

    const readStuffed = (): BitSample => {
      const bit = reader.nextStuffed()
      if (bit === null) throw new TruncatedFrame(sampleCount)
      crcInput.push(bit.value)
      return bit
    }
    const readRaw = (): BitSample => {
      const bit = reader.nextRaw()
      if (bit === null) throw new TruncatedFrame(sampleCount)
      return bit
    }
    const readValue = (bitCount: number): { value: number; bits: BitSample[] } => {
      let value = 0
      const bits: BitSample[] = []
      for (let i = 0; i < bitCount; i += 1) {
        const bit = readStuffed()
        value = (value << 1) | bit.value
        bits.push(bit)
      }
      return { value, bits }
    }

    // --- SOF ---------------------------------------------------------
    const sofBit = readStuffed()

    // --- Arbitration ---------------------------------------------------
    const baseId = readValue(11)
    const rtrOrSrr = readStuffed()
    const ide = readStuffed()

    let format: CanFrame['format']
    let id: number
    let rtr: boolean
    let arbitrationEnd: number
    let controlStart: number
    if (ide.value === 0) {
      // Standard: 11-bit ID, RTR, IDE=0, r0. Arbitration = ID + RTR.
      format = 'standard'
      id = baseId.value
      rtr = rtrOrSrr.value === 1
      arbitrationEnd = rtrOrSrr.endSample
      controlStart = ide.startSample
      readStuffed() // r0
    } else {
      // Extended: base ID, SRR, IDE=1, 18-bit extension, RTR, r1, r0.
      format = 'extended'
      const extension = readValue(18)
      const extRtr = readStuffed()
      readStuffed() // r1
      readStuffed() // r0
      id = baseId.value * 0x40000 + extension.value
      rtr = extRtr.value === 1
      arbitrationEnd = extRtr.endSample
      controlStart = extRtr.endSample
    }

    // --- Control -------------------------------------------------------
    const dlcBits = readValue(4)
    const dlc = dlcBits.value
    const controlEnd = dlcBits.bits[3].endSample
    let dataLength = rtr ? 0 : Math.min(dlc, 8)
    if (!rtr && dlc > 8) {
      frameErrors.push({
        code: 'invalid-dlc',
        message: `DLC=${dlc} 超出 Classic CAN 允许的 0-8，按 8 字节读取数据。`,
        startSample: dlcBits.bits[0].startSample,
        endSample: controlEnd,
      })
    }

    // --- Data ----------------------------------------------------------
    const data = new Uint8Array(dataLength)
    const dataStart = controlEnd
    let dataEnd = controlEnd
    for (let i = 0; i < dataLength; i += 1) {
      const byte = readValue(8)
      data[i] = byte.value
      dataEnd = byte.bits[7].endSample
    }

    // --- CRC sequence (stuffed) + delimiter (raw) ----------------------
    const crcInputLength = crcInput.length
    let receivedCrc = 0
    let crcStart = dataEnd
    let crcSeqEnd = dataEnd
    for (let i = 0; i < 15; i += 1) {
      const bit = readStuffed()
      if (i === 0) crcStart = bit.startSample
      receivedCrc = (receivedCrc << 1) | bit.value
      crcSeqEnd = bit.endSample
    }
    const computedCrc = computeCanCrc15(crcInput.slice(0, crcInputLength))
    const crcValid = receivedCrc === computedCrc
    if (!crcValid) {
      frameErrors.push({
        code: 'crc-mismatch',
        message:
          `CRC 校验失败：收到 0x${receivedCrc.toString(16).toUpperCase()}，` +
          `计算值 0x${computedCrc.toString(16).toUpperCase()}。`,
        startSample: crcStart,
        endSample: crcSeqEnd,
      })
    }

    // The fifth identical bit may be the final CRC sequence bit. In that
    // case a complementary stuff bit still appears before the delimiter.
    if (reader.needsStuffBit && reader.finishStuffedRegion() === null) {
      throw new TruncatedFrame(sampleCount)
    }
    const crcDelimiter = readRaw()
    if (crcDelimiter.value !== 1) {
      frameErrors.push({
        code: 'crc-delimiter-error',
        message: 'CRC 界定符应为隐性（1），实际为显性。',
        startSample: crcDelimiter.startSample,
        endSample: crcDelimiter.endSample,
      })
    }

    // --- ACK ------------------------------------------------------------
    const ackSlot = readRaw()
    const acknowledged = ackSlot.value === 0
    const ackDelimiter = readRaw()
    if (ackDelimiter.value !== 1) {
      frameErrors.push({
        code: 'ack-delimiter-error',
        message: 'ACK 界定符应为隐性（1），实际为显性。',
        startSample: ackDelimiter.startSample,
        endSample: ackDelimiter.endSample,
      })
    }

    // --- EOF -------------------------------------------------------------
    let eofStart = ackDelimiter.endSample
    let eofEnd = ackDelimiter.endSample
    for (let i = 0; i < 7; i += 1) {
      const bit = readRaw()
      if (i === 0) eofStart = bit.startSample
      if (bit.value !== 1 && !frameErrors.some((e) => e.code === 'eof-error')) {
        frameErrors.push({
          code: 'eof-error',
          message: `EOF 第 ${i + 1} 位应为隐性（1），实际为显性。`,
          startSample: bit.startSample,
          endSample: bit.endSample,
        })
      }
      eofEnd = bit.endSample
    }

    const fields: CanFieldSpan[] = [
      { field: 'sof', startSample: sofBit.startSample, endSample: sofBit.endSample },
      { field: 'arbitration', startSample: sofBit.endSample, endSample: arbitrationEnd },
      { field: 'control', startSample: controlStart, endSample: controlEnd },
      { field: 'data', startSample: dataStart, endSample: dataEnd },
      { field: 'crc', startSample: dataEnd, endSample: crcDelimiter.endSample },
      { field: 'ack', startSample: ackSlot.startSample, endSample: ackDelimiter.endSample },
      { field: 'eof', startSample: eofStart, endSample: eofEnd },
    ]

    return {
      index,
      startSample: sofBit.startSample,
      endSample: eofEnd,
      format,
      id,
      idHex: id
        .toString(16)
        .toUpperCase()
        .padStart(format === 'extended' ? 8 : 3, '0'),
      rtr,
      dlc,
      data,
      crc: receivedCrc,
      crcValid,
      acknowledged,
      errors: frameErrors,
      fields,
    }
  }
}
