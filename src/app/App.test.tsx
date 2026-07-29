import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import type { AnalysisResult } from '../core/types'
import type {
  CompleteMessage,
  FailedMessage,
  ProgressMessage,
  WorkerRequest,
} from '../workers/protocol'

vi.mock('uplot', () => ({
  default: class FakeUPlot {
    root = document.createElement('div')
    setData() {}
    setSize() {}
    setScale() {}
    destroy() {}
  },
}))

class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((event: { data: unknown }) => void) | null = null
  posted: WorkerRequest[] = []
  terminated = false

  constructor() {
    FakeWorker.instances.push(this)
  }

  postMessage(message: WorkerRequest) {
    this.posted.push(message)
  }

  terminate() {
    this.terminated = true
  }

  emit(message: ProgressMessage | CompleteMessage | FailedMessage) {
    this.onmessage?.({ data: message })
  }
}

function makeResult(): AnalysisResult {
  return {
    metadata: {
      sampleRateHz: 50_000_000,
      unit: 'mV',
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
    frames: [],
    errors: [],
    warnings: [],
  }
}

function makeOverview() {
  return {
    bucketStart: new Int32Array([0]),
    min: new Float32Array([0]),
    max: new Float32Array([1]),
    bucketSize: 1,
    sampleCount: 64_080,
  }
}

function makeDigital() {
  return {
    transitions: new Int32Array([0]),
    initialHigh: true,
    sampleCount: 64_080,
  }
}

function lastWorker(): FakeWorker {
  return FakeWorker.instances[FakeWorker.instances.length - 1]
}

function lastRequestId(worker: FakeWorker): number {
  const analyze = worker.posted.filter((m) => m.type === 'analyze').at(-1)
  return analyze?.requestId ?? 0
}

async function importFile(name: string): Promise<FakeWorker> {
  const input = screen.getByLabelText(/导入.*CSV/) as HTMLInputElement
  await userEvent.upload(input, new File(['x'], name, { type: 'text/csv' }))
  return lastWorker()
}

describe('App shell', () => {
  it('renders the analyzer heading', () => {
    render(<App />)
    expect(
      screen.getByRole('heading', { name: 'CAN Waveform Analyzer' }),
    ).toBeInTheDocument()
  })

  it('links to the GitHub repository from the header', () => {
    render(<App />)
    const link = screen.getByRole('link', { name: /GitHub/i })
    expect(link).toHaveAttribute(
      'href',
      expect.stringContaining('github.com'),
    )
    expect(link).toHaveAttribute('target', '_blank')
  })
})

describe('App analysis workflow', () => {
  beforeEach(() => {
    FakeWorker.instances = []
    vi.stubGlobal('Worker', FakeWorker)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the import input enabled during analysis (supersede path)', async () => {
    render(<App />)
    await importFile('a.csv')
    expect(screen.getByText(/正在分析 a\.csv/)).toBeInTheDocument()
    expect(screen.getByLabelText(/导入.*CSV/)).toBeEnabled()
  })

  it('terminates the worker on cancel so the computation actually stops', async () => {
    render(<App />)
    const worker = await importFile('a.csv')
    await userEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(worker.terminated).toBe(true)
    expect(screen.queryByText(/正在分析/)).not.toBeInTheDocument()
    // The next import gets a fresh worker and a new request id.
    const next = await importFile('b.csv')
    expect(next).not.toBe(worker)
    expect(lastRequestId(next)).toBeGreaterThan(lastRequestId(worker))
  })

  it('importing a new file supersedes and terminates the in-flight request', async () => {
    render(<App />)
    const first = await importFile('a.csv')
    const second = await importFile('b.csv')
    expect(first.terminated).toBe(true)
    expect(second).not.toBe(first)
    expect(screen.getByText(/正在分析 b\.csv/)).toBeInTheDocument()
  })

  it('clears previous results when a new import fails (mutually exclusive states)', async () => {
    render(<App />)
    const worker = await importFile('good.csv')
    act(() => {
      worker.emit({
        type: 'complete',
        requestId: lastRequestId(worker),
        result: makeResult(),
        overview: makeOverview(),
        digital: makeDigital(),
      })
    })
    expect(screen.getByText('good.csv')).toBeInTheDocument()

    const worker2 = await importFile('bad.csv')
    // Old results disappear as soon as the new analysis starts.
    expect(screen.queryByText('good.csv')).not.toBeInTheDocument()
    act(() => {
      worker2.emit({
        type: 'failed',
        requestId: lastRequestId(worker2),
        message: '第 1 行: 无法识别的文件头。',
      })
    })
    expect(screen.getByRole('alert')).toHaveTextContent('第 1 行')
    expect(screen.queryByText('good.csv')).not.toBeInTheDocument()
    expect(screen.queryByText(/文件摘要|采样率/)).not.toBeInTheDocument()
  })

  it('ignores late messages from superseded requests', async () => {
    render(<App />)
    const first = await importFile('a.csv')
    const staleId = lastRequestId(first)
    await importFile('b.csv')
    act(() => {
      first.emit({
        type: 'complete',
        requestId: staleId,
        result: makeResult(),
        overview: makeOverview(),
        digital: makeDigital(),
      })
    })
    // Still loading b.csv; the stale completion did not surface.
    expect(screen.getByText(/正在分析 b\.csv/)).toBeInTheDocument()
    expect(screen.queryByText('a.csv')).not.toBeInTheDocument()
  })
})
