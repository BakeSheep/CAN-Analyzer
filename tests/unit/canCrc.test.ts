import { computeCanCrc15 } from '../../src/core/canCrc'

/** MSB-first bits of an ASCII string. */
function asciiBits(text: string): Array<0 | 1> {
  const bits: Array<0 | 1> = []
  for (const char of text) {
    const byte = char.charCodeAt(0)
    for (let i = 7; i >= 0; i -= 1) {
      bits.push(((byte >> i) & 1) as 0 | 1)
    }
  }
  return bits
}

describe('computeCanCrc15', () => {
  it('returns 0 for an empty bit stream (init value 0)', () => {
    expect(computeCanCrc15([])).toBe(0)
  })

  it('returns 0 for all-zero input (zero register never flips)', () => {
    expect(computeCanCrc15(new Array<0 | 1>(64).fill(0))).toBe(0)
  })

  it('matches the Bosch spec definition for a single 1 bit → polynomial 0x4599', () => {
    // From the CAN 2.0 spec CRC register equations: feeding one dominant-
    // mismatch bit XORs the polynomial into the empty register.
    expect(computeCanCrc15([1])).toBe(0x4599)
  })

  it('matches the CRC catalogue check value: "123456789" → 0x059E', () => {
    // CRC-15/CAN in the RevEng catalogue: width=15 poly=0x4599 init=0
    // refin=false refout=false xorout=0 check=0x059E.
    expect(computeCanCrc15(asciiBits('123456789'))).toBe(0x059e)
  })

  it('stays within 15 bits for long pseudo-random input', () => {
    const bits: Array<0 | 1> = []
    let x = 123456789
    for (let i = 0; i < 4096; i += 1) {
      x = (x * 1103515245 + 12345) & 0x7fffffff
      bits.push(((x >> 16) & 1) as 0 | 1)
    }
    const crc = computeCanCrc15(bits)
    expect(crc).toBeGreaterThanOrEqual(0)
    expect(crc).toBeLessThan(1 << 15)
  })

  it('accepts any iterable of bits', () => {
    function* generate(): Generator<0 | 1> {
      yield 1
    }
    expect(computeCanCrc15(generate())).toBe(0x4599)
  })
})
