import { render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AnalyzerControls } from './AnalyzerControls'
import { DropZone } from './DropZone'
import { ErrorBanner } from './ErrorBanner'
import { FileSummary } from './FileSummary'
import { FrameDetails } from './FrameDetails'
import { FrameTable } from './FrameTable'
import type { AnalysisResult, CanFrame } from '../core/types'

vi.mock('uplot', () => ({
  default: class FakeUPlot {
    root = document.createElement('div')
    setData() {}
    setSize() {}
    setScale() {}
    destroy() {}
  },
}))

function makeFrame(overrides: Partial<CanFrame> = {}): CanFrame {
  return {
    index: 0,
    startSample: 1000,
    endSample: 2000,
    format: 'standard',
    id: 0x123,
    idHex: '123',
    rtr: false,
    dlc: 2,
    data: new Uint8Array([0xab, 0xcd]),
    crc: 0x1234,
    crcValid: true,
    acknowledged: true,
    errors: [],
    fields: [
      { field: 'sof', startSample: 1000, endSample: 1010 },
      { field: 'arbitration', startSample: 1010, endSample: 1130 },
      { field: 'control', startSample: 1130, endSample: 1190 },
      { field: 'data', startSample: 1190, endSample: 1350 },
      { field: 'crc', startSample: 1350, endSample: 1510 },
      { field: 'ack', startSample: 1510, endSample: 1530 },
      { field: 'eof', startSample: 1530, endSample: 1600 },
    ],
    ...overrides,
  }
}

function makeResult(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    metadata: {
      sampleRateHz: 50_000_000,
      unit: 'mV',
      probe: 'X1',
      sampleCount: 64_080,
      min: -2323,
      max: 108,
    },
    levels: {
      lowLevel: -2220,
      highLevel: 0,
      threshold: -1110,
      hysteresis: 222,
      noiseEstimate: 20,
      confidence: 0.95,
    },
    settings: {
      thresholdMv: -1110,
      hysteresisMv: 222,
      dominantIsLow: true,
      bitrateBps: 500_000,
      invertPolarity: false,
      manualBitrate: false,
    },
    bitrate: { candidates: [], reliable: true, warnings: [] },
    frames: [makeFrame()],
    errors: [],
    warnings: [],
    ...overrides,
  }
}

describe('DropZone', () => {
  it('offers keyboard-accessible file selection', async () => {
    const onFile = vi.fn()
    render(<DropZone onFile={onFile} disabled={false} />)
    const input = screen.getByLabelText(/导入.*CSV|选择.*CSV/) as HTMLInputElement
    const file = new File(['CH(mV)'], '000.CSV', { type: 'text/csv' })
    await userEvent.upload(input, file)
    expect(onFile).toHaveBeenCalledWith(file)
  })

  it('shows a drag-active state and accepts drops', () => {
    const onFile = vi.fn()
    render(<DropZone onFile={onFile} disabled={false} />)
    const zone = screen.getByTestId('drop-zone')
    fireEvent.dragOver(zone)
    expect(zone.className).toMatch(/drag-active/)
    fireEvent.dragLeave(zone)
    expect(zone.className).not.toMatch(/drag-active/)
    const file = new File(['x'], 'a.csv', { type: 'text/csv' })
    fireEvent.drop(zone, { dataTransfer: { files: [file] } })
    expect(onFile).toHaveBeenCalledWith(file)
  })

  it('ignores input while disabled', () => {
    const onFile = vi.fn()
    render(<DropZone onFile={onFile} disabled />)
    const zone = screen.getByTestId('drop-zone')
    fireEvent.drop(zone, {
      dataTransfer: { files: [new File(['x'], 'a.csv')] },
    })
    expect(onFile).not.toHaveBeenCalled()
  })
})

describe('FileSummary', () => {
  it('shows metadata, levels, bitrate, polarity, and confidence', () => {
    render(<FileSummary fileName="000.CSV" result={makeResult()} />)
    expect(screen.getByText('000.CSV')).toBeInTheDocument()
    expect(screen.getByText(/50\s*MHz|50,?000,?000/)).toBeInTheDocument()
    expect(screen.getByText(/64,?080|64080/)).toBeInTheDocument()
    expect(screen.getByText(/500\s*kbit\/s|500000/)).toBeInTheDocument()
    expect(screen.getByText(/95\s*%/)).toBeInTheDocument()
  })

  it('surfaces low-confidence warnings', () => {
    const result = makeResult({ warnings: ['两电平区分度不足，请手动设置阈值。'] })
    render(<FileSummary fileName="a.csv" result={result} />)
    expect(screen.getByText(/两电平区分度不足/)).toBeInTheDocument()
  })
})

describe('AnalyzerControls', () => {
  it('applies a manual bitrate override', async () => {
    const onApply = vi.fn()
    render(
      <AnalyzerControls settings={makeResult().settings} onApply={onApply} disabled={false} />,
    )
    await userEvent.selectOptions(screen.getByLabelText(/比特率/), '250000')
    await userEvent.click(screen.getByRole('button', { name: /重新分析/ }))
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ bitrateBps: 250_000 }),
    )
  })

  it('applies threshold and hysteresis overrides', async () => {
    const onApply = vi.fn()
    render(
      <AnalyzerControls settings={makeResult().settings} onApply={onApply} disabled={false} />,
    )
    const threshold = screen.getByLabelText(/阈值/)
    await userEvent.clear(threshold)
    await userEvent.type(threshold, '-900')
    await userEvent.click(screen.getByRole('button', { name: /重新分析/ }))
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ thresholdMv: -900 }),
    )
  })

  it('supports polarity selection', async () => {
    const onApply = vi.fn()
    render(
      <AnalyzerControls settings={makeResult().settings} onApply={onApply} disabled={false} />,
    )
    await userEvent.selectOptions(screen.getByLabelText(/极性/), 'invert')
    await userEvent.click(screen.getByRole('button', { name: /重新分析/ }))
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ invertPolarity: true }),
    )
  })
})

describe('FrameTable', () => {
  const frames = [
    makeFrame(),
    makeFrame({
      index: 1,
      id: 0x456,
      idHex: '456',
      startSample: 3000,
      endSample: 4000,
      crcValid: false,
      errors: [
        {
          code: 'crc-mismatch',
          message: 'CRC 校验失败',
          startSample: 3500,
          endSample: 3600,
        },
      ],
    }),
  ]

  it('renders rows with uppercase hex and status text (not color only)', () => {
    render(
      <FrameTable frames={frames} selectedIndex={null} onSelect={() => {}} />,
    )
    expect(screen.getByText('123')).toBeInTheDocument()
    expect(screen.getAllByText(/AB CD/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/正常|OK/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/错误|CRC/).length).toBeGreaterThan(0)
  })

  it('filters by ID and by status', async () => {
    render(
      <FrameTable frames={frames} selectedIndex={null} onSelect={() => {}} />,
    )
    const idFilter = screen.getByLabelText(/按 ID 过滤/)
    await userEvent.type(idFilter, '456')
    expect(screen.queryByText('123')).not.toBeInTheDocument()
    expect(screen.getByText('456')).toBeInTheDocument()
    await userEvent.clear(idFilter)
    await userEvent.selectOptions(screen.getByLabelText(/按状态过滤/), 'error')
    expect(screen.queryByText('123')).not.toBeInTheDocument()
    expect(screen.getByText('456')).toBeInTheDocument()
  })

  it('selects a row on click and reports it', async () => {
    const onSelect = vi.fn()
    render(
      <FrameTable frames={frames} selectedIndex={null} onSelect={onSelect} />,
    )
    await userEvent.click(screen.getByText('456'))
    expect(onSelect).toHaveBeenCalledWith(1)
  })

  it('marks the selected row', () => {
    render(
      <FrameTable frames={frames} selectedIndex={1} onSelect={() => {}} />,
    )
    const row = screen.getByText('456').closest('tr')!
    expect(row.getAttribute('aria-selected')).toBe('true')
  })

  it('shows an empty state when no frames match', () => {
    render(<FrameTable frames={[]} selectedIndex={null} onSelect={() => {}} />)
    expect(screen.getByText(/未解码出任何帧|没有匹配/)).toBeInTheDocument()
  })
})

describe('FrameDetails', () => {
  it('shows field spans, payload, and errors without stack traces', () => {
    const frame = makeFrame({
      crcValid: false,
      errors: [
        {
          code: 'crc-mismatch',
          message: 'CRC 校验失败：收到 0x1234，计算值 0x1235。',
          startSample: 1350,
          endSample: 1510,
        },
      ],
    })
    render(<FrameDetails frame={frame} sampleRateHz={50_000_000} />)
    const details = screen.getByTestId('frame-details')
    expect(within(details).getByText(/arbitration|仲裁/)).toBeInTheDocument()
    expect(within(details).getByText(/AB CD/)).toBeInTheDocument()
    expect(within(details).getByText(/CRC 校验失败/)).toBeInTheDocument()
    expect(details.textContent).not.toMatch(/at\s+\w+\s+\(/)
  })

  it('renders a placeholder when nothing is selected', () => {
    render(<FrameDetails frame={null} sampleRateHz={50_000_000} />)
    expect(screen.getByText(/选择.*帧/)).toBeInTheDocument()
  })
})

describe('ErrorBanner', () => {
  it('announces errors via role=alert and can be dismissed', async () => {
    const onDismiss = vi.fn()
    render(<ErrorBanner message="第 3 行: 样本值无效。" onDismiss={onDismiss} />)
    expect(screen.getByRole('alert')).toHaveTextContent('第 3 行')
    await userEvent.click(screen.getByRole('button', { name: /关闭/ }))
    expect(onDismiss).toHaveBeenCalled()
  })
})
