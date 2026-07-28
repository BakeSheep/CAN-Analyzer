import type { Capture, CaptureMetadata } from './types'

export interface ParseProgress {
  /** Characters consumed so far. */
  processed: number
  /** Total characters in the input text. */
  total: number
}

/** Error raised for malformed oscilloscope CSV input. */
export class ScopeCsvParseError extends Error {
  /** 1-based line number where the problem was found. */
  readonly line: number

  constructor(line: number, message: string) {
    super(`第 ${line} 行: ${message}`)
    this.name = 'ScopeCsvParseError'
    this.line = line
  }
}

const HEADER_PATTERN =
  /^\s*(?<channel>[^(\s,]+)\s*\(\s*(?<unit>[^)]+?)\s*\)(?<rest>.*)$/i
const PROBE_PATTERN = /probe\s*:\s*(?<probe>[^\s,]+)/i
const RATE_PATTERN = /sampling\s*rate\s*:\s*(?<rate>[0-9][0-9.eE+-]*)/i

/** Strict decimal/scientific notation; rejects hex, Infinity, NaN, etc. */
const NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/

/** Report progress at most every this many samples. */
const PROGRESS_SAMPLE_INTERVAL = 50_000

/**
 * Parse an oscilloscope CSV export: a metadata header line such as
 * `CH(mV)  probe:X1,sampling rate : 50000000` followed by one numeric
 * sample per line. Scans line boundaries incrementally instead of
 * splitting the whole text so multi-megabyte captures avoid large
 * temporary arrays.
 */
export function parseScopeCsv(
  text: string,
  onProgress?: (progress: ParseProgress) => void,
): Capture {
  const total = text.length
  let offset = 0
  let line = 0

  // Strip a UTF-8 BOM if present.
  if (text.charCodeAt(0) === 0xfeff) offset = 1

  const nextLine = (): { content: string; line: number } | null => {
    while (offset < total) {
      let end = text.indexOf('\n', offset)
      if (end === -1) end = total
      line += 1
      let content = text.slice(offset, end)
      offset = end + 1
      if (content.endsWith('\r')) content = content.slice(0, -1)
      content = content.trim()
      if (content.length > 0) return { content, line }
    }
    return null
  }

  const header = nextLine()
  if (header === null) {
    throw new ScopeCsvParseError(1, '文件为空，请导入示波器导出的 CSV 文件。')
  }

  const headerMatch = HEADER_PATTERN.exec(header.content)
  if (headerMatch === null || headerMatch.groups === undefined) {
    throw new ScopeCsvParseError(
      header.line,
      `无法识别的文件头 “${truncate(header.content)}”。` +
        '预期形如 “CH(mV)  probe:X1,sampling rate : 50000000”。',
    )
  }
  const unit = headerMatch.groups.unit
  const probeMatch = PROBE_PATTERN.exec(header.content)
  const rateMatch = RATE_PATTERN.exec(header.content)
  if (rateMatch === null || rateMatch.groups === undefined) {
    throw new ScopeCsvParseError(
      header.line,
      '文件头缺少采样率（sampling rate）。请确认导出选项包含采样率信息。',
    )
  }
  const sampleRateHz = Number(rateMatch.groups.rate)
  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
    throw new ScopeCsvParseError(
      header.line,
      `sampling rate 无效（${rateMatch.groups.rate}），必须是正数。`,
    )
  }

  let samples = new Float32Array(Math.max(1024, Math.ceil(total / 8)))
  let count = 0
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  let sinceProgress = 0

  onProgress?.({ processed: offset, total })

  for (let entry = nextLine(); entry !== null; entry = nextLine()) {
    if (!NUMBER_PATTERN.test(entry.content)) {
      throw new ScopeCsvParseError(
        entry.line,
        `样本值 “${truncate(entry.content)}” 不是有效数字。` +
          '每行应只包含一个十进制或科学计数法数值。',
      )
    }
    const value = Number(entry.content)
    // Values are stored as Float32; e.g. 1e100 is a finite Number but
    // overflows to Infinity in a Float32Array and would poison quantization.
    if (!Number.isFinite(value) || !Number.isFinite(Math.fround(value))) {
      throw new ScopeCsvParseError(
        entry.line,
        `样本值 “${truncate(entry.content)}” 超出可处理的数值范围（Float32）。` +
          '请检查导出数据的单位与量程。',
      )
    }
    if (count === samples.length) {
      const grown = new Float32Array(samples.length * 2)
      grown.set(samples)
      samples = grown
    }
    samples[count] = value
    count += 1
    if (value < min) min = value
    if (value > max) max = value

    sinceProgress += 1
    if (sinceProgress >= PROGRESS_SAMPLE_INTERVAL) {
      sinceProgress = 0
      onProgress?.({ processed: Math.min(offset, total), total })
    }
  }

  if (count === 0) {
    throw new ScopeCsvParseError(
      header.line + 1,
      '文件头之后没有样本数据（no samples）。请确认导出的 CSV 包含波形数据。',
    )
  }

  onProgress?.({ processed: total, total })

  const metadata: CaptureMetadata = {
    sampleRateHz,
    unit,
    probe: probeMatch?.groups?.probe,
    sampleCount: count,
    min,
    max,
  }
  return { metadata, samples: samples.slice(0, count) }
}

function truncate(value: string, limit = 40): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value
}
