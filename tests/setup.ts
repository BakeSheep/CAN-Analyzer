import '@testing-library/jest-dom/vitest'

// jsdom lacks matchMedia; uPlot queries it at module load for DPR tracking.
if (typeof window !== 'undefined' && window.matchMedia === undefined) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList
}
