# 里程碑 10 工作文档：统一测试输出与调试启动修复

## 完成功能范围

- 修复 CodeLens `Run Test` / `Run Case` 只输出到普通 output view，未进入 VSCode Test Results 的问题。
- 新增 CodeLens 专用 Testing API `TestController`，把每次 CodeLens 运行包装为 `TestRun`。
- CodeLens 运行改为使用 `go test -json`，将 stdout、stderr、失败详情和最终状态写入 Test Results。
- Output Channel 继续保留 runner 命令、Go 输出和诊断信息，但不再是 CodeLens 运行结果的唯一入口。
- 修复 Debug 入口只写入 debug configuration 日志、没有确认实际 debug session 的问题。
- Debug 配置改为使用 package 目录作为 `cwd`，并按官方 Go 扩展的 `["-test.run", pattern]` 形式传入测试过滤条件。
- Debug 启动后会等待对应 debug session 事件；如果启动请求被接受但没有观测到 session，会向用户显示 warning，但不再误判为启动失败。

## 核心文件和模块

- `src/testResults.ts`：新增 CodeLens Test Results reporter，创建 `TestRun` 并解析 `go test -json` 输出。
- `src/extension.ts`：CodeLens Run 改为调用 Test Results reporter；Debug 启动增加 session 确认。
- `src/testing.ts`：Test Explorer Debug profile 同步增加 session 确认。
- `src/debugger.ts`：调整 Go debug configuration 的 `cwd` 和 `args`。
- `test/debugger.test.ts`：更新 debug configuration 断言，覆盖 `["-test.run", pattern]`。
- `docs/product-requirements.md`：新增里程碑 10，并明确所有运行入口都必须写入 Test Results。
- `docs/milestone-9-summary.md`：同步 debug 参数形式。

## 实现思路与设计取舍

- CodeLens 本身不是 Testing API 节点，无法直接写入 Test Results；因此新增一个轻量 controller：`Go Bench CodeLens Runs`。
- 每次 CodeLens Run 创建一个和目标对应的 `TestItem`，再创建 `TestRun` 写入 Test Results。
- CodeLens Run 使用 `go test -json`，这样可以从结构化事件中提取 output、pass、fail、skip 和 elapsed。
- 对无法精确映射到当前目标的输出，仍写入本次 `TestRun` 的全局输出，避免输出丢失。
- Debug 启动配置把 `cwd` 设为 package 目录，贴近 Go test binary 的真实运行目录。
- Debug 参数保持官方 Go 扩展使用的 `["-test.run", pattern]`，减少和 Go debug adapter 行为分叉的风险。
- `vscode.debug.startDebugging` 返回成功后仍会等待 `onDidStartDebugSession` 作为额外诊断；如果没有观测到 session，只显示 warning，不把已接受的 debug request 当作失败。

## 当前插件内可进行的操作

- 点击 `Run Test`：运行目标测试函数，并在 Test Results 中查看输出、状态和失败详情。
- 点击 `Run Case`：运行目标 table case，并在 Test Results 中查看输出、状态和失败详情。
- 查看辅助诊断：`Go Bench` output channel 仍显示 runner 命令和 Go 输出。
- 点击 `Debug Test` / `Debug Case`：启动对应 Go test debug session。
- 如果 VSCode 接受 debug request 但没有产生 session：插件会显示 warning，提示调试没有真正启动。

## 当前可进行操作

### 编译扩展

- 用途：验证新增 Test Results reporter 和 debug session 确认逻辑类型正确。
- 命令：`npm run compile`
- 预期结果：`tsc -p ./` 通过。
- 失败优先检查：`vscode.TestRunRequest`、`vscode.TestController`、`vscode.debug.onDidStartDebugSession` 类型。

### 运行完整自动化测试

- 用途：验证 parser、runner、CodeLens、Testing API 树模型和 debug 配置构造。
- 命令：`npm test`
- 预期结果：当前通过 40 个断言，全部通过。
- 失败优先检查：debug configuration 的 `cwd` 和 `args` 断言、run pattern 构造。

### 运行 lint

- 用途：验证新增 Test Results reporter 和 debug 启动确认逻辑风格。
- 命令：`npm run lint`
- 预期结果：ESLint 无报错。
- 失败优先检查：显式返回类型、未使用导入、异步回调。

### 手动验证 CodeLens Run 输出

- 用途：确认 CodeLens Run 不再只写入 output view。
- 入口：打开 Go `_test.go` 文件，点击 `Run Test` 或 `Run Case`。
- 预期结果：VSCode Test Results 视图显示本次运行的 stdout、stderr、状态和失败详情。
- 失败优先检查：是否出现 `Go Bench CodeLens Runs` controller、`go test -json` 是否正常输出事件、Test Results 是否选中最新 run。

### 手动验证 Debug 启动

- 用途：确认 Debug 入口真正启动 session。
- 入口：点击 `Debug Test` 或 `Debug Case`。
- 预期结果：VSCode 进入 Go test debug session；如果没有 session，插件显示 warning。
- 失败优先检查：官方 Go 扩展、Delve、output channel 中的 debug configuration、`cwd` 是否为 package 目录、`args` 是否为 `["-test.run", pattern]`。

## 测试记录

- 日期：2026-06-19
- 命令：`npm test`
  - 结果：通过，Node test 运行 40 个断言，全部通过。
- 命令：`npm run lint`
  - 结果：通过，ESLint 未报告问题。

## 已知问题和后续计划

- CodeLens Test Results reporter 目前是轻量 controller，会在 Test Explorer 中出现 `Go Bench CodeLens Runs`。
- 当前仍缺少 Extension Host e2e 自动化测试，Test Results UI 和真实 debug session 需要手动验证。
- Debug 入口仍依赖官方 Go 扩展和 Delve；缺失时只能通过 VSCode debug API 的返回值和 session 事件做诊断。
