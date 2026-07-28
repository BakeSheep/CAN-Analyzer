import { computeCanCrc15 } from '../../src/core/canCrc'

/**
 * Bit-exact Classic CAN frame encoder for decoder tests.
 * Produces the raw (stuffed) bit stream from SOF through EOF.
 */
export interface FrameSpec {
  id: number
  extended?: boolean
  rtr?: boolean
  /** Defaults to data length; may exceed 8 to exercise invalid DLC. */
  dlc?: number
  data?: number[]
  /** XOR the computed CRC with this mask to force a mismatch. */
  crcXor?: number
  /** CRC delimiter bit, default 1 (recessive). */
  crcDelimiter?: 0 | 1
  /** ACK slot bit: 0 = acknowledged (default), 1 = no ACK. */
  ackSlot?: 0 | 1
  /** ACK delimiter bit, default 1. */
  ackDelimiter?: 0 | 1
  /** EOF bits, default seven recessive bits. */
  eof?: ReadonlyArray<0 | 1>
}

function pushValue(bits: Array<0 | 1>, value: number, width: number): void {
  for (let i = width - 1; i >= 0; i -= 1) {
    bits.push(((value >> i) & 1) as 0 | 1)
  }
}

/** Insert CAN stuff bits (opposite bit after five equal bits). */
export function applyStuffing(bits: ReadonlyArray<0 | 1>): Array<0 | 1> {
  const out: Array<0 | 1> = []
  let runLevel: 0 | 1 | null = null
  let runLength = 0
  for (const bit of bits) {
    if (runLength === 5) {
      const stuff: 0 | 1 = runLevel === 1 ? 0 : 1
      out.push(stuff)
      runLevel = stuff
      runLength = 1
    }
    out.push(bit)
    if (bit === runLevel) {
      runLength += 1
    } else {
      runLevel = bit
      runLength = 1
    }
    if (runLength === 5) continue
  }
  // CRC sequence is part of the stuffed region. If its final bit completes
  // a five-bit run, the complementary bit is transmitted before delimiter.
  if (runLength === 5) {
    out.push(runLevel === 1 ? 0 : 1)
  }
  return out
}

/** Raw transmitted bits for one frame: SOF..EOF, stuffing applied. */
export function encodeFrameBits(spec: FrameSpec): Array<0 | 1> {
  const {
    id,
    extended = false,
    rtr = false,
    data = [],
    dlc = data.length,
    crcXor = 0,
    crcDelimiter = 1,
    ackSlot = 0,
    ackDelimiter = 1,
    eof = [1, 1, 1, 1, 1, 1, 1],
  } = spec

  const logical: Array<0 | 1> = [0] // SOF
  if (extended) {
    pushValue(logical, (id >> 18) & 0x7ff, 11) // base ID
    logical.push(1) // SRR
    logical.push(1) // IDE
    pushValue(logical, id & 0x3ffff, 18) // ID extension
    logical.push(rtr ? 1 : 0) // RTR
    logical.push(0) // r1
    logical.push(0) // r0
  } else {
    pushValue(logical, id & 0x7ff, 11)
    logical.push(rtr ? 1 : 0) // RTR
    logical.push(0) // IDE
    logical.push(0) // r0
  }
  pushValue(logical, dlc & 0xf, 4)
  if (!rtr) {
    for (const byte of data) pushValue(logical, byte & 0xff, 8)
  }

  const crc = (computeCanCrc15(logical) ^ crcXor) & 0x7fff
  pushValue(logical, crc, 15)

  const stuffed = applyStuffing(logical)
  return [...stuffed, crcDelimiter, ackSlot, ackDelimiter, ...eof]
}
