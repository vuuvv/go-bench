# 里程碑 8 工作文档：Test Explorer 集合运行结果展示

## 完成功能范围

- Test Explorer 中运行函数合集节点时，会展开该节点下已注册的 table case 子节点，并为合集和子测试都创建 Testing API 运行状态。
- Testing API 运行路径改为使用 `go test -json`，通过结构化事件将 `run`、`pass`、`fail`、`skip` 映射回对应 `TestItem`。
- `go test` 的 stdout、stderr 和失败详情会写入 VSCode Test Results 视图关联的 `TestRun`。
- Output Channel 保留为辅助诊断入口，但不再是 Testing API 运行结果的唯一查看位置。
- 失败子测试会生成关联到对应子测试节点的 `TestMessage`，优先使用该子测试的 Go 输出作为失败详情。
- 补充 JSON 事件解析和 runner `-json` 命令构造测试。

## 核心文件和模块

- `src/testing.ts`：重写 Test Explorer 运行流程，按请求根节点构造运行组，展开子节点状态，并把 JSON 事件写入 `TestRun`。
- `src/runner.ts`：为 runner 增加 `json`、stdout/stderr 回调、原始输出收集和可选原始输出写入控制。
- `src/goTestJson.ts`：新增 `go test -json` 流式解析和 Go test name 映射工具。
- `test/goTestJson.test.ts`：覆盖 JSON 事件解析、chunk 边界和 subtest name 映射。
- `test/runner.test.ts`：覆盖 `go test -json` 命令展示构造。
- `docs/testing-api-evaluation.md`：同步 Testing API 当前运行结果展示能力。

## 实现思路与设计取舍

- 点击合集节点时只运行一次合集目标，例如 `TestXxx`，而不是对每个子 case 分别启动 `go test`。这样符合 Go 测试函数的真实执行模型，也避免重复运行 setup。
- 运行组会包含请求节点本身和其未被排除的子节点。父子同时出现在 include 列表时，只保留父节点作为运行根，避免重复执行。
- `go test -json` stdout 按行流式解析；完整 JSON event 立即用于更新 Test Results 输出和节点状态，半行缓存到后续 chunk。
- 事件中的 `Output` 字段写入 Test Results，并按 `Test` 字段关联到具体子测试节点；没有 `Test` 字段或无法映射的输出写入本次 test run 的全局输出。
- Output Channel 不再接收 JSON 原文，而是接收用户可读的 Go output 和 runner 命令记录，避免诊断内容被 JSON 行淹没。
- CodeLens 运行入口继续使用普通 `go test` 输出路径，不受 Testing API 的 `-json` 运行方式影响。

## 当前插件内可进行的操作

- 启用实验测试树：设置 `goBench.tableTests.testingApi.enabled` 为 `true`。
- 刷新测试树：打开 Go `_test.go` 文件，或执行 `Go Bench: Refresh Test Tree` / `Go Bench: Refresh Current File Test Tree`。
- 在 Test Explorer 中运行函数合集节点：插件会执行该函数下所有 Go subtest，并在合集和每个可识别 table case 前显示运行状态。
- 在 Test Explorer 中运行单个 table case 节点：插件会使用对应 `-run` pattern 运行目标 case，并把结果显示在该 case 节点上。
- 查看运行输出：打开 VSCode Test Results 视图，可以查看本次运行的 stdout、stderr 和失败详情。
- 查看辅助诊断：`Go Bench` Output Channel 仍显示 runner 命令、parser 诊断和 Go 输出，便于排查环境问题。
- Testing API 未启用时：Test Explorer 不创建 Go Bench 测试树，CodeLens 运行入口仍按原有方式工作。

## 当前可进行操作

### 编译扩展

- 用途：验证 runner、JSON parser 和 Testing API 适配层类型正确。
- 命令：`npm run compile`
- 预期结果：`tsc -p ./` 通过。
- 失败优先检查：`vscode.TestRun.appendOutput` 参数、`TestMessage` 构造和 runner 回调类型。

### 运行完整自动化测试

- 用途：验证 parser、runner、CodeLens、Testing API 树模型和 `go test -json` 解析工具。
- 命令：`npm test`
- 预期结果：当前通过 39 个断言，全部通过。
- 失败优先检查：JSON event fixture、Go test name rewrite、runner 命令参数顺序。

### 运行 lint

- 用途：验证新增 TypeScript 代码风格和显式返回类型。
- 命令：`npm run lint`
- 预期结果：ESLint 无报错。
- 失败优先检查：新增 helper 函数返回类型、未使用导入、异步回调类型。

### 手动验证合集节点运行

- 用途：确认 Test Explorer 运行函数合集节点时，子测试状态和输出都进入 Testing API。
- 入口：启用 `goBench.tableTests.testingApi.enabled`，刷新 Test Explorer 后点击 `Go Bench Table Tests` 下的 `TestXxx` 函数节点 run。
- 预期结果：函数节点和其 table case 子节点都会显示运行状态；任一子测试失败时，对应子节点显示失败，合集节点最终也显示失败。
- 失败优先检查：测试树是否已刷新、目标文件是否有可静态解析 table case、Test Results 视图是否选中最新 run。

### 手动查看 Test Results 输出

- 用途：确认 Testing API 运行结果不再只能从 Output Channel 查看。
- 入口：在 Test Explorer 运行函数节点或 case 节点，然后打开 VSCode Test Results 视图。
- 预期结果：Test Results 显示本次 `go test` 的 stdout、stderr 和失败详情；失败输出尽可能关联到具体子测试节点。
- 失败优先检查：`go test -json` 是否正常输出事件、失败 case 名称是否能映射到已注册 `TestItem`。

## 测试记录

- 日期：2026-06-18
- 命令：`npm test`
  - 结果：通过，Node test 运行 39 个断言，全部通过。
- 命令：`npm run lint`
  - 结果：通过，ESLint 未报告问题。

## 已知问题和后续计划

- 当前仍缺少 Extension Host e2e 自动化测试，真实 Test Explorer UI 需要手动验证。
- `go test -json` 事件只能精确映射 parser 已注册的 table case；无法静态识别的动态 subtest 输出会写入全局 Test Results 输出。
- Testing API 仍默认关闭，后续是否正式默认启用还需要继续评估与官方 Go 插件测试树的共存体验。
- nested subtests 尚未完整建模；已有名称中包含 `/` 的 case 会按 Go testing 规则展开匹配和映射。
