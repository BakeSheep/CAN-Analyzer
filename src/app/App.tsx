export default function App() {
  return (
    <>
      <header className="app-header">
        <h1>CAN Waveform Analyzer</h1>
        <p className="privacy-note">
          导入示波器 CSV，检测比特率并解码 Classic CAN 帧。分析全部在本地浏览器完成，数据不会上传。
        </p>
      </header>
      <main className="app-main">
        <section aria-label="分析区域" />
      </main>
      <footer className="app-footer">
        <p>MIT Licensed · Classic CAN 2.0A/2.0B · v0.1.0</p>
      </footer>
    </>
  )
}
