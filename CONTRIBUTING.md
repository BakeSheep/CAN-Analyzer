# 贡献指南

感谢你对 CAN Waveform Analyzer 的兴趣！

## 开发流程

1. Fork 并克隆仓库，运行 `npm ci`。
2. 创建特性分支：`git checkout -b feat/my-feature`。
3. 遵循 TDD：先为行为写失败测试，再实现，保持 `npm test -- --run`、`npm run typecheck`、`npm run build` 全部通过。
4. 提交信息使用 Conventional Commits（`feat:`、`fix:`、`docs:`、`chore:` 等）。
5. 发起 Pull Request，说明动机与验证方式。

## 代码约定

- `src/core/` 中的模块必须保持框架无关、确定性、可单元测试；不得引入 React 或 DOM 依赖。
- 样本索引是唯一时间坐标；秒仅用于显示层换算。
- 用户可见错误信息使用中文并给出可操作的补救建议。
- 不提交任何真实捕获文件（`.gitignore` 已默认排除 `*.csv`）。

## 范围边界（v1）

请勿在未讨论的情况下提交以下方向的 PR：CAN FD/XL、DBC 导入、后端服务、硬件实时采集。这些超出当前 MVP 范围。

## 报告问题

提 Issue 时请附带：浏览器版本、复现步骤、（若可分享）最小化的合成 CSV 片段，以及期望/实际行为。
