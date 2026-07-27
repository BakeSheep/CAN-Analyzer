/** Small hand-written oscilloscope CSV fixtures for parser tests. */

export const SMALL_SCOPE_HEADER = 'CH(mV)  probe:X1,sampling rate : 50000000'

export const SMALL_SCOPE_VALUES = [
  0, -12.5, -2220, -2222.75, 108, -2323, 0.001, 42,
]

/** Canonical small capture: header + one sample per line, LF endings. */
export const SMALL_SCOPE_CSV = [
  SMALL_SCOPE_HEADER,
  ...SMALL_SCOPE_VALUES.map(String),
  '',
].join('\n')

/** Same capture with BOM, CRLF endings, blank lines, and stray spaces. */
export const MESSY_SCOPE_CSV =
  '\uFEFF' +
  [
    'ch(MV)   probe: X1 , sampling rate :  50000000  ',
    '',
    ' 0 ',
    '-12.5',
    '',
    '-2220',
    '-2222.75',
    ' 108',
    '-2323 ',
    '1e-3',
    '4.2E1',
    '',
  ].join('\r\n')
