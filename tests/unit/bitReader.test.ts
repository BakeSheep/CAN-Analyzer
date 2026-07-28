import { BitReader, StuffBitError, type RawBit } from '../../src/core/bitReader'

/** Build raw bits with 100-sample spans so provenance is checkable. */
function rawBits(values: ReadonlyArray<0 | 1>): RawBit[] {
  return values.map((value, i) => ({
    value,
    startSample: i * 100,
    endSample: (i + 1) * 100,
  }))
}

describe('BitReader', () => {
  it('consumes the opposite stuff bit after five equal bits, keeping its span', () => {
    // Five 0s, stuff 1, then a genuine data 1.
    const reader = new BitReader(rawBits([0, 0, 0, 0, 0, 1, 1]))
    const logical = []
    for (let i = 0; i < 6; i += 1) logical.push(reader.nextStuffed()!)

    expect(logical.map((b) => b.value)).toEqual([0, 0, 0, 0, 0, 1])
    // The stuff bit was consumed, not returned…
    expect(logical[5].rawBitIndex).toBe(6)
    // …but stays traceable with its raw sample span.
    expect(reader.stuffBits).toHaveLength(1)
    expect(reader.stuffBits[0]).toMatchObject({
      value: 1,
      rawBitIndex: 5,
      startSample: 500,
      endSample: 600,
      isStuffBit: true,
    })
  })

  it('raises a stuff error on a sixth equal bit with full provenance', () => {
    const reader = new BitReader(rawBits([0, 0, 0, 0, 0, 0, 1]))
    for (let i = 0; i < 5; i += 1) reader.nextStuffed()
    try {
      reader.nextStuffed()
      expect.unreachable('expected a stuff error')
    } catch (error) {
      expect(error).toBeInstanceOf(StuffBitError)
      const stuffError = error as StuffBitError
      expect(stuffError.rawBitIndex).toBe(5)
      expect(stuffError.logicalBitIndex).toBe(5)
      expect(stuffError.startSample).toBe(500)
      expect(stuffError.endSample).toBe(600)
    }
  })

  it('lets a stuff bit start a new run that gets stuffed again', () => {
    // 0×5, stuff(1), 1×4 → run of five 1s including the stuff bit,
    // then stuff(0), then data 1.
    const reader = new BitReader(
      rawBits([0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 1]),
    )
    const values: number[] = []
    for (let bit = reader.nextStuffed(); bit !== null; bit = reader.nextStuffed()) {
      values.push(bit.value)
    }
    expect(values).toEqual([0, 0, 0, 0, 0, 1, 1, 1, 1, 1])
    expect(reader.stuffBits.map((b) => b.rawBitIndex)).toEqual([5, 10])
  })

  it('consumes a pending stuff bit before entering the raw trailer', () => {
    // Five CRC-sequence 1s require a trailing stuff 0 before the recessive
    // CRC delimiter. The delimiter itself and ACK slot are then unstuffed.
    const reader = new BitReader(rawBits([1, 1, 1, 1, 1, 0, 1, 0]))
    for (let i = 0; i < 5; i += 1) reader.nextStuffed()
    expect(reader.needsStuffBit).toBe(true)
    expect(reader.finishStuffedRegion()).toMatchObject({
      value: 0,
      rawBitIndex: 5,
      isStuffBit: true,
    })
    const delimiter = reader.nextRaw()!
    expect(delimiter.value).toBe(1)
    expect(delimiter.rawBitIndex).toBe(6)
    expect(delimiter.isStuffBit).toBe(false)
    expect(reader.stuffBits).toHaveLength(1)
    // Subsequent raw reads keep flowing without stuffing rules.
    expect(reader.nextRaw()?.value).toBe(0)
  })

  it('does not consume a raw trailer bit when no final stuff bit is due', () => {
    const reader = new BitReader(rawBits([1, 0, 1]))
    reader.nextStuffed()
    reader.nextStuffed()
    expect(reader.needsStuffBit).toBe(false)
    expect(reader.finishStuffedRegion()).toBeNull()
    expect(reader.nextRaw()?.value).toBe(1)
  })

  it('returns null at the end of the stream', () => {
    const reader = new BitReader(rawBits([1, 0]))
    expect(reader.nextStuffed()?.value).toBe(1)
    expect(reader.nextStuffed()?.value).toBe(0)
    expect(reader.nextStuffed()).toBeNull()
    expect(reader.nextRaw()).toBeNull()
  })

  it('returns null when the stream ends where a stuff bit was expected', () => {
    const reader = new BitReader(rawBits([0, 0, 0, 0, 0]))
    for (let i = 0; i < 5; i += 1) reader.nextStuffed()
    expect(reader.nextStuffed()).toBeNull()
  })

  it('tracks raw and logical positions for overlays and navigation', () => {
    const reader = new BitReader(rawBits([0, 0, 0, 0, 0, 1, 1]))
    for (let i = 0; i < 6; i += 1) reader.nextStuffed()
    expect(reader.rawIndex).toBe(7) // five data + stuff + one data
    expect(reader.logicalIndex).toBe(6)
  })

  it('supports starting from an arbitrary raw offset', () => {
    const reader = new BitReader(rawBits([1, 1, 0, 0, 1]), 2)
    expect(reader.nextStuffed()).toMatchObject({ value: 0, rawBitIndex: 2 })
  })
})
