# CAN Waveform Analyzer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build and publish an MIT-licensed, browser-only CAN waveform analyzer that imports oscilloscope CSV files like `000.CSV`, plots the signal, detects bitrate, and decodes Classic CAN 2.0A/2.0B frames.

**Architecture:** Use a Vite + React + TypeScript single-page application hosted as static files on GitHub Pages. Parsing, signal quantization, bitrate detection, and CAN decoding run in a Web Worker so large captures do not freeze the UI; decoded results and downsampled plot data return to the main thread. Keep the decode engine as framework-independent TypeScript modules with deterministic unit tests.

**Tech Stack:** React, TypeScript, Vite, Vitest, Testing Library, uPlot, Web Workers, GitHub Actions, GitHub Pages.

---

## Scope and acceptance criteria

### MVP includes

- Local file import only; capture data never leaves the browser.
- The supplied format: first line such as `CH(mV)  probe:X1,sampling rate : 50000000`, followed by one numeric sample per line.
- UTF-8/BOM, CRLF/LF, blank-line tolerance, decimal/scientific numeric values, and useful parse errors.
- Waveform overview with zoom, pan, cursor time/voltage, and decoded-frame overlays.
- Automatic two-level thresholding, polarity selection, and manual overrides.
- Automatic bitrate detection for common Classic CAN rates from 10 kbit/s through 1 Mbit/s, plus a manual rate field.
- Classic CAN 2.0A and 2.0B data/remote frames: ID, IDE, RTR, DLC, payload, CRC status, ACK status, timestamps, and frame-level errors.
- Bit-stuffing validation, CRC-15/CAN validation, delimiter/EOF validation, and resynchronization after malformed frames.
- Frame filtering, selection-to-waveform navigation, and decoded JSON/CSV export.
- Responsive desktop UI, basic keyboard accessibility, MIT license, README, tests, and automatic GitHub Pages deployment.

### Explicitly out of scope for v1

- CAN FD, CAN XL, DBC import, live USB/serial hardware capture, server-side upload, user accounts, and cloud storage.
- Guaranteed decoding of captures without an observable idle-to-SOF edge or captures whose sample rate is too low.

### Supplied-file baseline

- Manual acceptance input: `D:\Download\000.CSV` (do not commit this user file unless the owner explicitly approves redistribution).
- Observed metadata: 50,000,000 samples/s.
- Observed samples: 64,080; duration: 1.2816 ms; approximate range: -2323 to 108 mV.
- Dominant clusters are around 0 mV and -2.22 V. Clean threshold crossings are about 100 samples apart, so the expected auto-detected rate is 500 kbit/s.

## Recommended design decisions

1. **Use a protocol-specific TypeScript decoder, not a generic logic-analyzer package.** This keeps the repository small, testable, Pages-compatible, and tailored to the input format. A third-party decoder would shorten the first prototype but makes error locations, overlays, and worker transfer harder to control.
2. **Use a Web Worker with chunked parsing.** A main-thread prototype is simpler, but it will visibly block on multi-megabyte captures. The worker boundary should be added before UI integration, not retrofitted later.
3. **Use uPlot for the waveform.** SVG charts become costly with dense captures. A raw hand-written canvas offers maximum control but adds avoidable zoom, cursor, and HiDPI work.

## Proposed repository layout

```text
.
|-- .github/workflows/deploy-pages.yml
|-- docs/plans/2026-07-27-can-waveform-analyzer.md
|-- src/
|   |-- app/App.tsx
|   |-- components/{DropZone,FileSummary,AnalyzerControls,WaveformChart,FrameTable,FrameDetails,ErrorBanner}.tsx
|   |-- core/{types,csvParser,quantizer,bitrateDetector,canCrc,bitReader,canDecoder,exporters}.ts
|   |-- workers/{analyzer.worker,protocol}.ts
|   |-- styles/app.css
|   |-- main.tsx
|-- tests/
|   |-- fixtures/{makeCapture,small-scope}.ts
|   |-- unit/*.test.ts
|   |-- integration/analyzer.test.ts
|-- LICENSE
|-- README.md
|-- package.json
|-- vite.config.ts
|-- vitest.config.ts
`-- tsconfig*.json
```

---

### Task 1: Bootstrap the repository and test harness

**Files:**
- Create: `package.json`
- Create: `index.html`
- Create: `src/main.tsx`
- Create: `src/app/App.tsx`
- Create: `src/styles/app.css`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `tsconfig.json`
- Create: `tsconfig.app.json`
- Create: `tsconfig.node.json`
- Create: `.gitignore`

**Step 1: Initialize Git and scaffold Vite**

Run:

```powershell
git init
npm create vite@latest . -- --template react-ts
npm install
npm install uplot
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

Expected: a React TypeScript app starts with `npm run dev`.

**Step 2: Configure scripts and relative assets**

Set `package.json` scripts to `dev`, `build`, `preview`, `test`, `test:watch`, and `typecheck`. In `vite.config.ts`, set `base: './'` so the build works for both a project Pages site and local preview. Configure Vitest for `jsdom`, globals, and a setup file importing `@testing-library/jest-dom/vitest`.

**Step 3: Add a failing shell test**

Create `src/app/App.test.tsx` that renders `App` and expects the heading `CAN Waveform Analyzer` and the text `分析全部在本地浏览器完成`.

Run: `npm test -- --run src/app/App.test.tsx`

Expected: FAIL until the minimal shell is implemented.

**Step 4: Implement the minimal application shell**

Add a header, empty main analysis region, and import `uplot/dist/uPlot.min.css` and `src/styles/app.css`. Use semantic `header`, `main`, `section`, and `footer` elements.

**Step 5: Verify and commit**

Run:

```powershell
npm test -- --run
npm run typecheck
npm run build
git add .
git commit -m "chore: bootstrap CAN waveform analyzer"
```

Expected: tests, typecheck, and production build pass.

---

### Task 2: Define domain types and parse oscilloscope CSV

**Files:**
- Create: `src/core/types.ts`
- Create: `src/core/csvParser.ts`
- Create: `tests/unit/csvParser.test.ts`
- Create: `tests/fixtures/small-scope.ts`

**Step 1: Define stable domain contracts**

Add types for `CaptureMetadata`, `Capture`, `SignalLevels`, `BitrateCandidate`, `BitSample`, `CanFrame`, `DecodeError`, and `AnalysisResult`. Use `Float32Array` for voltage samples and numeric sample indexes as the canonical time coordinate; derive seconds as `sampleIndex / sampleRateHz` only for display.

Minimum parser API:

```ts
export interface ParseProgress { processed: number; total: number }
export function parseScopeCsv(
  text: string,
  onProgress?: (progress: ParseProgress) => void,
): Capture;
```

`CaptureMetadata` must include `sampleRateHz`, `unit`, optional `probe`, `sampleCount`, `min`, and `max`. Parser errors must include a line number and a short remediation message.

**Step 2: Write failing parser tests**

Cover:

- The exact header pattern `CH(mV)  probe:X1,sampling rate : 50000000`.
- BOM, arbitrary spaces, LF/CRLF, blank lines, negative values, decimals, and scientific notation.
- Missing/zero sampling rate, a nonnumeric sample, and an empty capture.
- Correct `Float32Array`, min/max, sample count, and duration.

Run: `npm test -- --run tests/unit/csvParser.test.ts`

Expected: FAIL because the parser does not exist.

**Step 3: Implement the parser**

Parse metadata case-insensitively with named regular-expression groups. Do not use `text.split(/\r?\n/)` for very large files in the final version; scan line boundaries incrementally to limit temporary allocations. Reject non-finite values. Report at most every 50,000 samples to avoid flooding the worker channel.

**Step 4: Verify and commit**

Run: `npm test -- --run tests/unit/csvParser.test.ts`

Expected: all parser tests pass.

```powershell
git add src/core/types.ts src/core/csvParser.ts tests
git commit -m "feat: parse oscilloscope CSV captures"
```

---

### Task 3: Quantize the analog waveform into a stable digital signal

**Files:**
- Create: `src/core/quantizer.ts`
- Create: `tests/unit/quantizer.test.ts`

**Step 1: Write failing quantizer tests**

Build synthetic captures with two noisy voltage clusters and assert:

- Low/high levels are estimated close to the source levels.
- Threshold defaults to their midpoint.
- Hysteresis suppresses single-sample chatter.
- Both polarities can be selected.
- Flat/noisy/non-bimodal captures produce an actionable low-confidence warning.
- Output uses transition runs rather than one JavaScript object per sample.

Run: `npm test -- --run tests/unit/quantizer.test.ts`

Expected: FAIL.

**Step 2: Implement robust level estimation**

Use a fixed-size histogram (for example 256 bins) and two-cluster iteration over bin centers. Initialize from the 10th and 90th percentiles, iterate until stable, and reject clusters with insufficient separation relative to within-cluster noise. Default the threshold to the cluster midpoint and hysteresis to 10% of cluster separation. Return transition indexes, run levels, cluster centers, threshold, noise estimate, and confidence.

**Step 3: Add manual overrides**

Accept optional `thresholdMv`, `hysteresisMv`, and `dominantIsLow`. Preserve these settings in the returned analysis metadata so exports are reproducible.

**Step 4: Verify and commit**

Run: `npm test -- --run tests/unit/quantizer.test.ts`

```powershell
git add src/core/quantizer.ts tests/unit/quantizer.test.ts
git commit -m "feat: quantize noisy CAN waveforms"
```

---

### Task 4: Detect bitrate and select a sampling phase

**Files:**
- Create: `src/core/bitrateDetector.ts`
- Create: `tests/unit/bitrateDetector.test.ts`
- Create: `tests/fixtures/makeCapture.ts`

**Step 1: Create a reusable synthetic capture generator**

Generate a logical bit stream at an exact rate, oversample it, apply selectable polarity, add deterministic seeded noise/jitter, and return a `Capture`. Keep it deterministic for CI.

**Step 2: Write failing detection tests**

Test 125 kbit/s, 250 kbit/s, 500 kbit/s, and 1 Mbit/s at several sample rates. Include jitter, long identical runs, inverse polarity, insufficient transitions, and a manual custom bitrate. For the supplied-file profile, assert 50 MHz / roughly 100 samples per bit ranks 500 kbit/s first.

**Step 3: Implement candidate scoring**

Evaluate common rates `[10000, 20000, 33333, 50000, 83333, 100000, 125000, 250000, 500000, 800000, 1000000]`. For each rate:

- Compute samples per bit and reject fewer than 4 samples/bit.
- Score each transition interval against the nearest positive integer multiple of the bit period.
- Penalize normalized timing residuals, weak transition counts, and inconsistent phase.
- Estimate phase from transition modulo values, then sample near 75% of each bit.
- Test both signal polarities and retain ranked candidates with confidence and diagnostic text.

Do not silently claim success below the confidence threshold; require manual bitrate/polarity selection.

**Step 4: Verify and commit**

Run: `npm test -- --run tests/unit/bitrateDetector.test.ts`

```powershell
git add src/core/bitrateDetector.ts tests/fixtures/makeCapture.ts tests/unit/bitrateDetector.test.ts
git commit -m "feat: auto-detect CAN bitrate and phase"
```

---

### Task 5: Implement bit de-stuffing and CRC-15/CAN

**Files:**
- Create: `src/core/canCrc.ts`
- Create: `src/core/bitReader.ts`
- Create: `tests/unit/canCrc.test.ts`
- Create: `tests/unit/bitReader.test.ts`

**Step 1: Write failing CRC tests**

Use at least two independently verified Classic CAN bit-vector fixtures. CRC input starts at SOF and ends at the last data/control bit before the CRC sequence; use polynomial `0x4599`, width 15, initial value 0, no reflection, and no final XOR.

**Step 2: Implement and verify CRC**

Expose `computeCanCrc15(bits: Iterable<0 | 1>): number`. Run only the CRC test file and confirm the known vectors pass.

**Step 3: Write failing de-stuffing tests**

Assert that after five equal bits, the opposite stuff bit is consumed but its raw sample span remains traceable. Assert that a sixth equal bit raises a stuff error with raw bit index, logical bit index, and sample range. Test the boundary: stuffing applies from SOF through the CRC sequence; CRC delimiter onward is unstuffed.

**Step 4: Implement a traceable bit reader**

Return logical bits carrying `{ value, rawBitIndex, startSample, endSample, isStuffBit }`. Keep raw-to-logical mappings for waveform overlays and error navigation.

**Step 5: Verify and commit**

Run: `npm test -- --run tests/unit/canCrc.test.ts tests/unit/bitReader.test.ts`

```powershell
git add src/core/canCrc.ts src/core/bitReader.ts tests/unit
git commit -m "feat: add CAN CRC and bit de-stuffing"
```

---

### Task 6: Decode Classic CAN 2.0A/2.0B frames

**Files:**
- Create: `src/core/canDecoder.ts`
- Create: `tests/unit/canDecoder.test.ts`

**Step 1: Write failing frame tests**

Create bit-exact fixtures for:

- Standard 11-bit data frame with DLC 0 and DLC 8.
- Extended 29-bit data frame.
- Standard and extended remote frames.
- Valid/invalid CRC, ACK present/absent, bad CRC delimiter, bad EOF, invalid DLC, and stuff error.
- Noise before SOF, truncated final frame, and recovery to the next valid frame after an error.

Expected fields: `startSample`, `endSample`, `format`, `id`, `idHex`, `rtr`, `dlc`, `data`, `crc`, `crcValid`, `acknowledged`, `errors`, and field/sample spans for SOF, arbitration, control, data, CRC, ACK, and EOF.

**Step 2: Implement field parsing**

Search for a dominant SOF only after an adequate recessive idle run. Parse the standard arbitration path (`11-bit ID, RTR, IDE=0, r0`) and extended path (`11-bit base ID, SRR, IDE=1, 18-bit extension, RTR, r1, r0`). Parse DLC and 0–8 bytes, then compare received and computed CRC.

**Step 3: Validate trailer and recover from errors**

Validate recessive CRC delimiter, ACK slot/delimiter, and seven recessive EOF bits. Treat a dominant ACK slot as acknowledged. On malformed data, record the narrowest error span and search from the next plausible idle/SOF boundary so one bad frame does not discard the rest of the capture.

**Step 4: Verify and commit**

Run: `npm test -- --run tests/unit/canDecoder.test.ts`

```powershell
git add src/core/canDecoder.ts tests/unit/canDecoder.test.ts
git commit -m "feat: decode Classic CAN frames"
```

---

### Task 7: Move the analysis pipeline into a Web Worker

**Files:**
- Create: `src/workers/protocol.ts`
- Create: `src/workers/analyzer.worker.ts`
- Create: `tests/integration/analyzer.test.ts`

**Step 1: Define the message protocol**

Use discriminated messages: `analyze`, `cancel`, `progress`, `complete`, and `failed`. Analysis phases are `reading`, `quantizing`, `detecting-bitrate`, and `decoding`. Give every request an ID so late messages from a cancelled file are ignored.

**Step 2: Write a failing pipeline integration test**

Pass a synthetic CSV through parse → quantize → detect → decode and assert metadata, bitrate, frame ID/data, CRC, and sample spans. Add cancellation and malformed-file cases.

**Step 3: Implement worker orchestration**

Read the selected `File` in the worker, send throttled progress, and transfer typed-array buffers where possible. Keep a cancellation check between major passes and periodically inside long loops. Return a decimated overview series plus exact transition/frame spans; do not duplicate the full waveform in multiple object graphs.

**Step 4: Verify and commit**

Run: `npm test -- --run tests/integration/analyzer.test.ts`

```powershell
git add src/workers tests/integration
git commit -m "feat: run waveform analysis in a worker"
```

---

### Task 8: Build import, controls, waveform, and frame inspection UI

**Files:**
- Create: `src/components/DropZone.tsx`
- Create: `src/components/FileSummary.tsx`
- Create: `src/components/AnalyzerControls.tsx`
- Create: `src/components/WaveformChart.tsx`
- Create: `src/components/FrameTable.tsx`
- Create: `src/components/FrameDetails.tsx`
- Create: `src/components/ErrorBanner.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/styles/app.css`
- Create: `src/components/components.test.tsx`

**Step 1: Write failing component tests**

Test keyboard file selection, drag/drop state, progress/cancel, bitrate and threshold overrides, low-confidence warning, frame filtering, row selection, empty/error states, and readable accessible labels.

**Step 2: Implement the analysis workflow**

State flow: `empty → loading → analyzed | error`; a new file cancels the previous request. Show file name, sample rate, sample count, duration, voltage range, detected levels, selected bitrate, polarity, and confidence. Changing manual controls re-runs analysis without rereading the file when feasible.

**Step 3: Implement the waveform**

Use uPlot with time on X and mV/V on Y. Provide zoom reset, cursor values, frame-colored overlays, and an overview-safe decimated series. Selecting a frame zooms to its span; selecting a chart overlay highlights the table row. Preserve original indexes so decimation never changes decode results.

**Step 4: Implement the frame table and details**

Columns: index, start time, ID, format, type, DLC, data, CRC, ACK, status. Support filtering by ID/status and render IDs/data in uppercase hex. Details show all field spans and errors without exposing raw internal stack traces.

**Step 5: Add responsive, accessible styling**

Use a high-contrast neutral theme, visible keyboard focus, a compact desktop split view, and stacked layout below 900 px. Respect `prefers-reduced-motion`. Do not rely on color alone for CRC/error states.

**Step 6: Verify and commit**

Run:

```powershell
npm test -- --run
npm run typecheck
npm run build
git add src
git commit -m "feat: add interactive CAN analysis UI"
```

---

### Task 9: Add decoded-data export

**Files:**
- Create: `src/core/exporters.ts`
- Create: `tests/unit/exporters.test.ts`
- Modify: `src/app/App.tsx`

**Step 1: Write failing export tests**

Assert deterministic JSON and RFC 4180-compatible CSV. CSV columns: `index,start_time_s,end_time_s,id,format,type,dlc,data,crc,crc_valid,acknowledged,status,errors`. Prevent spreadsheet formula injection by prefixing cells beginning with `=`, `+`, `-`, or `@`.

**Step 2: Implement exporters and download actions**

JSON must include source metadata and analysis settings before frames. Create downloads with `Blob` and revoke object URLs after click. Disable export until analysis succeeds and export the currently filtered set only when the button explicitly says so.

**Step 3: Verify and commit**

Run: `npm test -- --run tests/unit/exporters.test.ts`

```powershell
git add src/core/exporters.ts tests/unit/exporters.test.ts src/app/App.tsx
git commit -m "feat: export decoded CAN frames"
```

---

### Task 10: Document the project and apply the MIT license

**Files:**
- Create: `LICENSE`
- Create: `README.md`
- Create: `CONTRIBUTING.md`

**Step 1: Add MIT license text**

Use the standard MIT text with the current year and the repository owner's chosen legal name. Do not guess the copyright holder; use a clearly marked placeholder until the owner supplies it.

**Step 2: Write README**

Include: screenshot placeholder, live Pages URL placeholder, privacy statement, supported CSV grammar, features, limitations, local commands, architecture, test instructions, Pages setup, and an example using `000.CSV` without committing that file. State clearly that v1 supports Classic CAN only and that automatic detection can require manual correction for noisy/short captures.

**Step 3: Verify links and commit**

```powershell
git add LICENSE README.md CONTRIBUTING.md
git commit -m "docs: add MIT license and project guide"
```

---

### Task 11: Configure GitHub Pages deployment

**Files:**
- Create: `.github/workflows/deploy-pages.yml`

**Step 1: Add the official Pages workflow shape**

Trigger on pushes to `main` and manual dispatch. Grant only `contents: read`, `pages: write`, and `id-token: write`; set `concurrency.group: pages` and do not cancel an in-progress production deployment. Jobs must:

1. Check out the repository.
2. Set up the current LTS Node version with npm cache.
3. Run `npm ci`, `npm test -- --run`, `npm run typecheck`, and `npm run build`.
4. Configure Pages.
5. Upload `dist` as the Pages artifact.
6. Deploy with the official Pages deploy action and `environment: github-pages`.

Before implementation, verify current major versions against the official Vite static deployment guide and GitHub Pages custom-workflow documentation; action versions can change over time.

**Step 2: Test the production bundle locally**

Run:

```powershell
npm run build
npm run preview
```

Expected: the app loads from built assets, worker assets resolve correctly, and importing a synthetic CSV works.

**Step 3: Commit and publish**

```powershell
git add .github/workflows/deploy-pages.yml
git commit -m "ci: deploy analyzer to GitHub Pages"
git branch -M main
git remote add origin https://github.com/<owner>/<repo>.git
git push -u origin main
```

In repository Settings → Pages, select **GitHub Actions** as the source. Expected: the workflow succeeds and reports the public Pages URL.

---

### Task 12: Final verification with the supplied capture

**Files:**
- Modify if needed: tests and source files associated with any discovered defect
- Modify: `README.md`

**Step 1: Run automated gates**

```powershell
npm ci
npm test -- --run
npm run typecheck
npm run build
```

Expected: all commands exit 0 with no unhandled worker errors.

**Step 2: Perform the supplied-file acceptance test**

Open the production preview and import `D:\Download\000.CSV`. Confirm:

- Header parses as 50 MHz and 64,080 samples.
- Duration displays as about 1.2816 ms and voltage range is plausible.
- Automatic bitrate ranks 500 kbit/s first.
- UI remains responsive during analysis.
- Waveform, threshold, bit boundaries, and frame overlays align visually.
- Every reported good frame has valid stuffing, CRC, delimiters, and EOF; malformed spans are localized and do not prevent later-frame recovery.
- Table selection zooms the chart and JSON/CSV exports reproduce visible fields.

Do not hard-code a particular frame ID or payload until it is independently checked against a trusted CAN decoder or a second implementation. If the supplied capture disagrees with the synthetic fixtures, preserve the fixture tests, isolate whether polarity/phase/edge synchronization is wrong, and add the smallest regression fixture that reproduces the defect.

**Step 3: Test realistic failure cases manually**

Try an empty file, malformed header, a text file renamed to CSV, a flat waveform, a very short capture, manual wrong bitrate, and repeated import/cancel. Confirm errors are actionable and the app can recover without reload.

**Step 4: Record verified behavior and commit fixes**

Update README with the verified sample behavior and any measured practical file-size limit. Commit each actual defect separately, then finish with:

```powershell
git status --short
git log --oneline --decorate -12
```

Expected: clean working tree and a readable series of focused commits.

## Definition of done

- All automated tests, typecheck, and production build pass from a clean clone.
- The supplied capture detects 500 kbit/s and yields inspectable frame/error results without freezing the UI.
- No file content is uploaded to a server.
- The public Pages URL works after a hard refresh and worker assets load from the project subpath.
- Repository contains standard MIT text with the correct copyright holder.
- README accurately documents supported CSV input, Classic CAN limitations, privacy, local development, and deployment.

## Handoff instructions for the executing agent

Execute tasks in order with `executing-plans`. After Tasks 4, 6, 8, and 12, stop for a checkpoint and report test output plus any deviation from this design. Ask the owner only for values that cannot safely be inferred: GitHub repository owner/name and the legal copyright-holder string. Do not add DBC, CAN FD, back-end services, or hardware access during the MVP.
