import { render, screen } from '@testing-library/react'
import App from './App'

describe('App shell', () => {
  it('renders the analyzer heading', () => {
    render(<App />)
    expect(
      screen.getByRole('heading', { name: 'CAN Waveform Analyzer' }),
    ).toBeInTheDocument()
  })

  it('states that analysis happens locally in the browser', () => {
    render(<App />)
    expect(screen.getByText(/分析全部在本地浏览器完成/)).toBeInTheDocument()
  })
})
