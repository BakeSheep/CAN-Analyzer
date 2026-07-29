import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export type Language = 'zh' | 'en'

const STORAGE_KEY = 'can-analyzer-lang'

/** Chinese is the source of truth; English mirrors every key. */
const MESSAGES = {
  zh: {
    'header.langLabel': 'EN',
    'header.langAria': 'Switch to English',
    'phase.reading': '读取文件',
    'phase.quantizing': '量化波形',
    'phase.detecting-bitrate': '检测比特率',
    'phase.decoding': '解码 CAN 帧',
    'app.importAria': '导入与状态',
    'app.analyzing': '正在分析 {name}：{phase}（{pct}%）',
    'app.cancel': '取消',
    'app.captureErrors': '捕获级错误',
    'app.exportJson': '导出全部帧 JSON',
    'app.exportCsv': '导出全部帧 CSV',
    colon: '：',
    sampleSpan: '（样本 {start} – {end}）',
    'drop.hint': '将示波器导出的 CSV 文件拖放到此处，或',
    'drop.button': '导入 CSV 文件',
    'error.close': '关闭',
    'summary.aria': '文件摘要',
    'summary.sampleRate': '采样率',
    'summary.sampleCount': '样本数',
    'summary.duration': '时长',
    'summary.voltageRange': '电压范围',
    'summary.levels': '检测电平',
    'summary.levelsValue': '低 {low} / 高 {high} {unit}',
    'summary.threshold': '判决阈值',
    'summary.bitrate': '比特率',
    'summary.manual': '（手动）',
    'summary.auto': '（自动）',
    'summary.polarity': '极性',
    'summary.inverted': '反转',
    'summary.normal': '正常',
    'summary.confidence': '电平置信度',
    'summary.warningsAria': '分析警告',
    'controls.aria': '分析设置',
    'controls.bitrate': '比特率',
    'controls.autoDetect': '自动检测（当前 {current}）',
    'controls.custom': '自定义…',
    'controls.customBitrate': '自定义比特率 (bit/s)',
    'controls.customBitrateError': '请输入大于 0 的自定义比特率（bit/s）。',
    'controls.threshold': '判决阈值 (mV)',
    'controls.thresholdError': '阈值必须是有限数值（mV，可为负）。',
    'controls.hysteresis': '滞回带 (mV)',
    'controls.hysteresisError': '滞回带必须是不小于 0 的数值（mV）。',
    'controls.polarity': '极性',
    'controls.polarityAuto': '自动（解码成功率确认）',
    'controls.polarityNormal': '正常',
    'controls.polarityInvert': '反转',
    'controls.reanalyze': '重新分析',
    'table.aria': '解码帧列表',
    'table.filterId': '按 ID 过滤（HEX）',
    'table.filterIdPlaceholder': '如 123',
    'table.filterStatus': '按状态过滤',
    'table.all': '全部',
    'table.ok': '正常',
    'table.error': '错误',
    'table.count': '{visible} / {total} 帧',
    'table.emptyNoFrames': '未解码出任何帧。请检查比特率、极性与阈值设置。',
    'table.emptyNoMatch': '没有匹配当前过滤条件的帧。',
    'table.dataAria': '帧数据',
    'table.colStart': '起始时间',
    'table.colFormat': '格式',
    'table.colType': '类型',
    'table.colData': '数据',
    'table.colStatus': '状态',
    'table.extended': '扩展',
    'table.standard': '标准',
    'table.remote': '远程',
    'table.dataFrame': '数据',
    'table.ackYes': '有',
    'table.ackNo': '无',
    'table.statusOk': '✓ 正常',
    'table.errorFallback': '错误',
    'details.aria': '帧详情',
    'details.empty': '在表格或波形中选择一个帧查看详情。',
    'details.heading': '帧 #{index} · ID {id} · {kind}',
    'details.kindStandardData': '标准数据帧',
    'details.kindStandardRemote': '标准远程帧',
    'details.kindExtendedData': '扩展数据帧',
    'details.kindExtendedRemote': '扩展远程帧',
    'details.timeRange': '时间范围',
    'details.data': '数据',
    'details.none': '（无）',
    'details.crcValid': '✓ 校验通过',
    'details.crcInvalid': '✗ 校验失败',
    'details.ackYes': '✓ 已应答',
    'details.ackNo': '✗ 无应答',
    'details.fieldSpans': '字段区间',
    'details.colField': '字段',
    'details.colStart': '起始 (ms)',
    'details.colEnd': '结束 (ms)',
    'details.colSamples': '样本区间',
    'details.frameErrors': '帧错误',
    'field.sof': 'SOF（帧起始）',
    'field.arbitration': '仲裁段',
    'field.control': '控制段',
    'field.data': '数据段',
    'field.crc': 'CRC 段',
    'field.ack': 'ACK 段',
    'field.eof': 'EOF（帧结束）',
    'chart.aria': '波形视图',
    'chart.resetZoom': '重置缩放',
    'chart.hint': '拖动框选可缩放；点击帧覆盖区或轴下帧色块可在表格中定位对应帧。',
    'chart.ack': '已应答',
    'chart.noack': '无应答',
    'chart.error': '错误',
    'chart.time': '时间 (ms)',
    'chart.voltage': '电压 ({unit})',
    'chart.min': '最小值 ({unit})',
    'chart.max': '最大值 ({unit})',
  },
  en: {
    'header.langLabel': '中',
    'header.langAria': '切换到中文',
    'phase.reading': 'Reading file',
    'phase.quantizing': 'Quantizing waveform',
    'phase.detecting-bitrate': 'Detecting bitrate',
    'phase.decoding': 'Decoding CAN frames',
    'app.importAria': 'Import & status',
    'app.analyzing': 'Analyzing {name}: {phase} ({pct}%)',
    'app.cancel': 'Cancel',
    'app.captureErrors': 'Capture-level errors',
    'app.exportJson': 'Export all frames JSON',
    'app.exportCsv': 'Export all frames CSV',
    colon: ': ',
    sampleSpan: ' (samples {start} – {end})',
    'drop.hint': 'Drop an oscilloscope CSV export here, or',
    'drop.button': 'Import CSV file',
    'error.close': 'Close',
    'summary.aria': 'File summary',
    'summary.sampleRate': 'Sample rate',
    'summary.sampleCount': 'Samples',
    'summary.duration': 'Duration',
    'summary.voltageRange': 'Voltage range',
    'summary.levels': 'Detected levels',
    'summary.levelsValue': 'Low {low} / High {high} {unit}',
    'summary.threshold': 'Threshold',
    'summary.bitrate': 'Bitrate',
    'summary.manual': ' (manual)',
    'summary.auto': ' (auto)',
    'summary.polarity': 'Polarity',
    'summary.inverted': 'Inverted',
    'summary.normal': 'Normal',
    'summary.confidence': 'Level confidence',
    'summary.warningsAria': 'Analysis warnings',
    'controls.aria': 'Analysis settings',
    'controls.bitrate': 'Bitrate',
    'controls.autoDetect': 'Auto detect (current {current})',
    'controls.custom': 'Custom…',
    'controls.customBitrate': 'Custom bitrate (bit/s)',
    'controls.customBitrateError':
      'Enter a custom bitrate greater than 0 (bit/s).',
    'controls.threshold': 'Threshold (mV)',
    'controls.thresholdError':
      'Threshold must be a finite number (mV, may be negative).',
    'controls.hysteresis': 'Hysteresis (mV)',
    'controls.hysteresisError':
      'Hysteresis must be a number no less than 0 (mV).',
    'controls.polarity': 'Polarity',
    'controls.polarityAuto': 'Auto (verified by decode success)',
    'controls.polarityNormal': 'Normal',
    'controls.polarityInvert': 'Inverted',
    'controls.reanalyze': 'Re-analyze',
    'table.aria': 'Decoded frame list',
    'table.filterId': 'Filter by ID (HEX)',
    'table.filterIdPlaceholder': 'e.g. 123',
    'table.filterStatus': 'Filter by status',
    'table.all': 'All',
    'table.ok': 'OK',
    'table.error': 'Error',
    'table.count': '{visible} / {total} frames',
    'table.emptyNoFrames':
      'No frames decoded. Check the bitrate, polarity, and threshold settings.',
    'table.emptyNoMatch': 'No frames match the current filters.',
    'table.dataAria': 'Frame data',
    'table.colStart': 'Start time',
    'table.colFormat': 'Format',
    'table.colType': 'Type',
    'table.colData': 'Data',
    'table.colStatus': 'Status',
    'table.extended': 'Extended',
    'table.standard': 'Standard',
    'table.remote': 'Remote',
    'table.dataFrame': 'Data',
    'table.ackYes': 'Yes',
    'table.ackNo': 'No',
    'table.statusOk': '✓ OK',
    'table.errorFallback': 'error',
    'details.aria': 'Frame details',
    'details.empty': 'Select a frame in the table or waveform to see details.',
    'details.heading': 'Frame #{index} · ID {id} · {kind}',
    'details.kindStandardData': 'Standard data frame',
    'details.kindStandardRemote': 'Standard remote frame',
    'details.kindExtendedData': 'Extended data frame',
    'details.kindExtendedRemote': 'Extended remote frame',
    'details.timeRange': 'Time range',
    'details.data': 'Data',
    'details.none': '(none)',
    'details.crcValid': '✓ valid',
    'details.crcInvalid': '✗ mismatch',
    'details.ackYes': '✓ acknowledged',
    'details.ackNo': '✗ no ACK',
    'details.fieldSpans': 'Field spans',
    'details.colField': 'Field',
    'details.colStart': 'Start (ms)',
    'details.colEnd': 'End (ms)',
    'details.colSamples': 'Sample range',
    'details.frameErrors': 'Frame errors',
    'field.sof': 'SOF (start of frame)',
    'field.arbitration': 'Arbitration',
    'field.control': 'Control',
    'field.data': 'Data',
    'field.crc': 'CRC',
    'field.ack': 'ACK',
    'field.eof': 'EOF (end of frame)',
    'chart.aria': 'Waveform view',
    'chart.resetZoom': 'Reset zoom',
    'chart.hint':
      'Drag to zoom; click a frame overlay or the strip under the axis to locate the frame in the table.',
    'chart.ack': 'ACK',
    'chart.noack': 'No ACK',
    'chart.error': 'Error',
    'chart.time': 'Time (ms)',
    'chart.voltage': 'Voltage ({unit})',
    'chart.min': 'Min ({unit})',
    'chart.max': 'Max ({unit})',
  },
} as const satisfies Record<Language, Record<string, string>>

export type MessageKey = keyof (typeof MESSAGES)['zh']

export type Translate = (
  key: MessageKey,
  params?: Record<string, string | number>,
) => string

interface I18nValue {
  lang: Language
  t: Translate
  toggleLang: () => void
}

function readStoredLang(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'zh' || stored === 'en') return stored
  } catch {
    // Storage may be unavailable (e.g. privacy mode); default below.
  }
  return 'zh'
}

function interpolate(
  text: string,
  params?: Record<string, string | number>,
): string {
  if (params === undefined) return text
  let result = text
  for (const [name, value] of Object.entries(params)) {
    result = result.replaceAll(`{${name}}`, String(value))
  }
  return result
}

/** Fallback for components rendered without a provider (e.g. unit tests). */
const DEFAULT_VALUE: I18nValue = {
  lang: 'zh',
  t: (key, params) => interpolate(MESSAGES.zh[key], params),
  toggleLang: () => {},
}

const I18nContext = createContext<I18nValue>(DEFAULT_VALUE)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Language>(readStoredLang)

  const toggleLang = useCallback(() => {
    setLang((current) => {
      const next: Language = current === 'zh' ? 'en' : 'zh'
      try {
        localStorage.setItem(STORAGE_KEY, next)
      } catch {
        // Persisting the preference is best-effort only.
      }
      return next
    })
  }, [])

  const t = useCallback<Translate>(
    (key, params) => interpolate(MESSAGES[lang][key], params),
    [lang],
  )

  const value = useMemo(
    () => ({ lang, t, toggleLang }),
    [lang, t, toggleLang],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  return useContext(I18nContext)
}
