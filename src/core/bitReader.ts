import type { BitSample } from './types'

/** One raw (still stuffed) bit sampled from the quantized waveform. */
export interface RawBit {
  value: 0 | 1
  /** First sample index covered by this bit. */
  startSample: number
  /** Exclusive end sample index. */
  endSample: number
}

/** Bit-stuffing violation: a sixth consecutive equal bit. */
export class StuffBitError extends Error {
  readonly rawBitIndex: number
  readonly logicalBitIndex: number
  readonly startSample: number
  readonly endSample: number

  constructor(bit: RawBit, rawBitIndex: number, logicalBitIndex: number) {
    super(
      `位填充错误：原始位 ${rawBitIndex}（样本 ${bit.startSample}-${bit.endSample}）` +
        `是第 6 个连续相同电平位。`,
    )
    this.name = 'StuffBitError'
    this.rawBitIndex = rawBitIndex
    this.logicalBitIndex = logicalBitIndex
    this.startSample = bit.startSample
    this.endSample = bit.endSample
  }
}

/**
 * Reads logical bits out of a raw bit stream while validating CAN bit
 * stuffing. Stuffing applies from SOF through the CRC sequence
 * (`nextStuffed`); the CRC delimiter onward is read unstuffed
 * (`nextRaw`). Consumed stuff bits stay traceable via `stuffBits` so
 * overlays and error navigation can point at exact sample spans.
 */
export class BitReader {
  /** Stuff bits consumed so far, with raw index and sample span. */
  readonly stuffBits: BitSample[] = []

  private position: number
  private logicalCount = 0
  private runLevel: 0 | 1 | null = null
  private runLength = 0

  constructor(
    private readonly bits: readonly RawBit[],
    startIndex = 0,
  ) {
    this.position = startIndex
  }

  /** Next raw bit index to be consumed. */
  get rawIndex(): number {
    return this.position
  }

  /** Number of logical (de-stuffed) bits returned so far. */
  get logicalIndex(): number {
    return this.logicalCount
  }

  /**
   * Read the next logical bit, consuming an intervening stuff bit when the
   * previous five bits were equal. Throws `StuffBitError` when the sixth
   * equal bit appears instead of the expected opposite stuff bit.
   */
  nextStuffed(): BitSample | null {
    if (this.runLength === 5) {
      const stuff = this.bits[this.position]
      if (stuff === undefined) return null
      if (stuff.value === this.runLevel) {
        throw new StuffBitError(stuff, this.position, this.logicalCount)
      }
      this.stuffBits.push({
        value: stuff.value,
        rawBitIndex: this.position,
        startSample: stuff.startSample,
        endSample: stuff.endSample,
        isStuffBit: true,
      })
      this.position += 1
      // The stuff bit itself starts a new run and may be stuffed again.
      this.runLevel = stuff.value
      this.runLength = 1
    }

    const bit = this.bits[this.position]
    if (bit === undefined) return null
    const rawBitIndex = this.position
    this.position += 1
    if (bit.value === this.runLevel) {
      this.runLength += 1
    } else {
      this.runLevel = bit.value
      this.runLength = 1
    }
    this.logicalCount += 1
    return {
      value: bit.value,
      rawBitIndex,
      startSample: bit.startSample,
      endSample: bit.endSample,
      isStuffBit: false,
    }
  }

  /** Read the next bit without stuffing rules (CRC delimiter onward). */
  nextRaw(): BitSample | null {
    const bit = this.bits[this.position]
    if (bit === undefined) return null
    const rawBitIndex = this.position
    this.position += 1
    this.logicalCount += 1
    return {
      value: bit.value,
      rawBitIndex,
      startSample: bit.startSample,
      endSample: bit.endSample,
      isStuffBit: false,
    }
  }
}
