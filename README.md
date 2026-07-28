# CAN Waveform Analyzer

一个运行在浏览器中的 CAN 示波器波形分析工具。

导入示波器导出的 CSV 采样数据后，工具将自动识别模拟信号电平、CAN 波特率与极性，并解析 Classic CAN 2.0A/2.0B 帧。所有分析均在本地浏览器中完成，原始数据不会上传到服务器。

> 当前状态：核心解析引擎已经完成；文件导入界面、波形图、Web Worker、结果导出和 GitHub Pages 部署仍在开发中。

## 已实现功能

- 解析示波器单通道 CSV 波形。
- 识别采样率、探头倍率、电压单位和样本数量。
- 使用双电平聚类和滞回判决将模拟波形转换为数字信号。
- 自动检测常见 CAN 波特率：
  - 10 / 20 / 33.333 / 50 / 83.333 kbit/s
  - 100 / 125 / 250 / 500 / 800 kbit/s
  - 1 Mbit/s
- 保留两种信号极性候选，并根据空闲电平证据排序。
- 解析 Classic CAN 标准帧和扩展帧：
  - 11 位与 29 位标识符
  - 数据帧与远程帧
  - DLC 与 0–8 字节数据
  - CRC-15/CAN
  - ACK
  - 位填充
  - CRC delimiter、ACK delimiter 和 EOF
- 定位 CRC、位填充、帧格式和截断错误。
- 在损坏帧之后继续搜索下一个有效帧。
- 使用确定性的合成波形测试不同电平、噪声、抖动、极性和波特率。

## 工作流程

```mermaid
flowchart LR
    A["示波器 CSV"] --> B["解析元数据与采样点"]
    B --> C["模拟电平聚类"]
    C --> D["数字化与跳变提取"]
    D --> E["波特率、相位与极性检测"]
    E --> F["CAN 位填充与 CRC 校验"]
    F --> G["CAN 帧与错误结果"]
```

采样点索引是内部的标准时间坐标，显示时间通过以下公式计算：

```text
timeSeconds = sampleIndex / sampleRateHz
```

## 支持的 CSV 格式

当前解析器支持以下示波器导出格式：

```csv
CH(mV)  probe:X1,sampling rate : 50000000
4
4
-1
-2218
-2223
8
13
```

格式要求：

- 第一行包含通道单位和 `sampling rate`。
- `probe` 字段可选。
- 第一行之后每行包含一个采样值。
- 支持正负数、小数和科学计数法。
- 支持 UTF-8 BOM、LF、CRLF 和空行。
- 不接受十六进制、`NaN`、`Infinity` 或超出 Float32 范围的数值。

解析失败时会返回具体行号和可读的错误说明。

## 快速开始

### 环境要求

- Node.js `^20.19.0` 或 `>=22.12.0`
- npm

### 安装依赖

```bash
npm install
```

### 启动开发服务器

```bash
npm run dev
```

Vite 会输出本地访问地址。当前页面仅包含应用外壳，完整的文件导入和分析界面仍在开发中。

### 运行测试

```bash
npm test -- --run
```

监听模式：

```bash
npm run test:watch
```

### 类型检查

```bash
npm run typecheck
```

### 构建生产版本

```bash
npm run build
```

构建结果位于 `dist/`。

本地预览生产构建：

```bash
npm run preview
```

## 样例验证

开发阶段使用了一份实际示波器文件进行回归验证，该文件不包含在仓库中：

| 项目 | 结果 |
| --- | ---: |
| 采样率 | 50 MHz |
| 采样点 | 64,080 |
| 时长 | 约 1.2816 ms |
| 电压范围 | -2323 至 108 mV |
| 自动识别波特率 | 500 kbit/s |
| 有效帧 | 5 个 CRC 正确的扩展帧 |
| 帧内容 | ID `0x100`，Data `1F 6B` |

这份文件仅用于本地验收，不会提交到仓库或上传到网络。

## 项目结构

```text
src/
├── app/                    React 应用外壳
├── core/
│   ├── csvParser.ts        示波器 CSV 解析
│   ├── quantizer.ts        模拟电平聚类与数字化
│   ├── bitrateDetector.ts  波特率、相位和极性检测
│   ├── bitReader.ts        CAN 位填充读取
│   ├── canCrc.ts           CRC-15/CAN
│   ├── canDecoder.ts       Classic CAN 帧解析
│   └── types.ts            公共领域类型
├── styles/
└── main.tsx

tests/
├── fixtures/               确定性合成波形与 CAN 帧
└── unit/                   单元和协议回归测试
```

## 技术栈

- React
- TypeScript
- Vite
- Vitest
- Testing Library
- uPlot

核心解析模块不依赖 React，可以独立测试，并将在后续阶段放入 Web Worker 中运行。

## 当前限制

- 仅支持 Classic CAN 2.0A/2.0B。
- 暂不支持 CAN FD、CAN XL 或 DBC 文件。
- 暂不支持实时 CAN 硬件、串口或 USB 采集。
- 暂不支持多通道差分波形组合。
- 自动检测需要足够的跳变和可识别的空闲区间。
- 每位少于 4 个采样点时不会执行 CAN 帧解码。
- 噪声过大、捕获过短或帧首尾被截断时，可能需要手动设置阈值、极性或波特率。

## 开发路线

- [x] CSV 解析
- [x] 模拟波形数字化
- [x] 波特率、采样相位和极性检测
- [x] CRC-15/CAN 与位填充
- [x] Classic CAN 2.0A/2.0B 帧解析
- [ ] Web Worker 分析流水线
- [ ] CSV 拖放与分析控制界面
- [ ] 可缩放波形图和帧字段覆盖层
- [ ] 帧列表、筛选和详情面板
- [ ] JSON/CSV 结果导出
- [ ] GitHub Actions 与 GitHub Pages
- [ ] DBC 与 CAN FD（后续版本）

详细实施计划见 [`docs/plans/2026-07-27-can-waveform-analyzer.md`](docs/plans/2026-07-27-can-waveform-analyzer.md)。

## 隐私

- 文件内容只在本地浏览器中读取和分析。
- 项目不需要后端服务器。
- 项目不包含遥测、账户或云端存储。
- GitHub Pages 仅用于托管静态应用文件。

## License

项目计划以 [MIT License](https://opensource.org/license/mit) 发布。正式发布前，需要在仓库根目录添加 `LICENSE` 文件，并填写正确的版权所有者名称。
