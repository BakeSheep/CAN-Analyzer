import type { AnalysisResult, CanFrame } from './types'

export const CSV_HEADER =
  'index,start_time_s,end_time_s,id,format,type,dlc,data,crc,crc_valid,acknowledged,status,errors'

function dataHex(data: Uint8Array): string {
  return Array.from(data)
    .map((byte) => byte.toString(16).toUpperCase().padStart(2, '0'))
    .join(' ')
}

function frameStatus(frame: CanFrame): 'ok' | 'error' {
  return frame.errors.length === 0 && frame.crcValid ? 'ok' : 'error'
}

/**
 * Deterministic JSON export: source metadata and analysis settings come
 * before the frames so consumers can validate context first.
 */
export function framesToJson(
  result: AnalysisResult,
  frames: readonly CanFrame[],
): string {
  const payload = {
    tool: 'can-waveform-analyzer',
    metadata: {
      sampleRateHz: result.metadata.sampleRateHz,
      unit: result.metadata.unit,
      probe: result.metadata.probe ?? null,
      sampleCount: result.metadata.sampleCount,
      min: result.metadata.min,
      max: result.metadata.max,
    },
    settings: {
      thresholdMv: result.settings.thresholdMv,
      hysteresisMv: result.settings.hysteresisMv,
      dominantIsLow: result.settings.dominantIsLow,
      bitrateBps: result.settings.bitrateBps,
      invertPolarity: result.settings.invertPolarity,
      manualBitrate: result.settings.manualBitrate,
    },
    warnings: result.warnings,
    frames: frames.map((frame) => ({
      index: frame.index,
      startTimeS: frame.startSample / result.metadata.sampleRateHz,
      endTimeS: frame.endSample / result.metadata.sampleRateHz,
      startSample: frame.startSample,
      endSample: frame.endSample,
      format: frame.format,
      id: frame.id,
      idHex: frame.idHex,
      rtr: frame.rtr,
      dlc: frame.dlc,
      data: Array.from(frame.data),
      crc: frame.crc,
      crcValid: frame.crcValid,
      acknowledged: frame.acknowledged,
      status: frameStatus(frame),
      errors: frame.errors.map((error) => ({
        code: error.code,
        message: error.message,
        startSample: error.startSample,
        endSample: error.endSample,
      })),
    })),
    captureErrors: result.errors.map((error) => ({
      code: error.code,
      message: error.message,
      startSample: error.startSample,
      endSample: error.endSample,
    })),
  }
  return JSON.stringify(payload, null, 2)
}

/**
 * Escape one CSV cell: neutralize spreadsheet formula injection first,
 * then apply RFC 4180 quoting.
 */
function csvCell(value: string): string {
  let cell = value
  // Cells beginning with =, +, - or @ are interpreted as formulas by
  // spreadsheet software; prefix them with a single quote.
  if (/^[=+\-@]/.test(cell)) cell = `'${cell}`
  if (/[",\r\n]/.test(cell)) {
    cell = `"${cell.replaceAll('"', '""')}"`
  }
  return cell
}

/** RFC 4180-compatible CSV with CRLF line endings and a trailing CRLF. */
export function framesToCsv(
  frames: readonly CanFrame[],
  sampleRateHz: number,
): string {
  const lines = [CSV_HEADER]
  for (const frame of frames) {
    const cells = [
      String(frame.index),
      String(frame.startSample / sampleRateHz),
      String(frame.endSample / sampleRateHz),
      frame.idHex,
      frame.format,
      frame.rtr ? 'remote' : 'data',
      String(frame.dlc),
      dataHex(frame.data),
      frame.crc.toString(16).toUpperCase().padStart(4, '0'),
      String(frame.crcValid),
      String(frame.acknowledged),
      frameStatus(frame),
      frame.errors
        .map((error) => `${error.code}: ${error.message}`)
        .join('; '),
    ]
    lines.push(cells.map(csvCell).join(','))
  }
  return `${lines.join('\r\n')}\r\n`
}
