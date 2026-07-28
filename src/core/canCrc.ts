/**
 * CRC-15/CAN as specified by Bosch CAN 2.0 (and the RevEng catalogue):
 * width 15, polynomial 0x4599, initial value 0, no reflection, no final
 * XOR. The CRC input covers SOF through the last data/control bit before
 * the CRC sequence, on the DE-STUFFED bit stream.
 */
export function computeCanCrc15(bits: Iterable<0 | 1>): number {
  let crc = 0
  for (const bit of bits) {
    const crcNext = bit ^ ((crc >> 14) & 1)
    crc = (crc << 1) & 0x7fff
    if (crcNext === 1) crc ^= 0x4599
  }
  return crc
}
