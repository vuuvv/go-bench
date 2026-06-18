# 里程碑 9 工作文档：Go 测试调试入口

## 完成功能范围

- 编辑器 CodeLens 为函数级测试新增 `Debug Test`。
- 编辑器 CodeLens 为已识别 table case 新增 `Debug Case`。
- 新增命令 `goBench.debugTest`，通过 VSCode debug API 启动 Go test debug session。
- 新增 Go test debug 配置构造模块，使用 `type: "go"`、`request: "launch"`、`mode: "test"` 和 `-test.run=<pattern>`。
- Test Explorer 新增 Debug profile，允许从函数节点或 case 节点启动调试。
- Debug 入口复用 Run 入口的 `GoTestRunTarget` 和 `buildRunPattern`，保证运行和调试选中同一个测试目标。
- 补充命令常量、manifest、CodeLens target 和 debug 配置构造测试。

## 核心文件和模块

- `src/debugger.ts`：新增 Go test debug configuration 构造逻辑。
- `src/constants.ts`：新增 `commands.debugTest`。
- `src/codelensTargets.ts`：新增 `Debug Test` 和 `Debug Case` CodeLens target。
- `src/codelens.ts`：将 debug target 映射到 `goBench.debugTest` 命令。
- `src/extension.ts`：注册 debug 命令，并调用 `vscode.debug.startDebugging`。
- `src/testing.ts`：为 Testing API controller 新增 Debug profile。
- `package.json`：贡献 `Go Bench: Debug Test` 命令。
- `test/debugger.test.ts`：覆盖 Go debug configuration。
- `test/codelensTargets.test.ts`、`test/constants.test.ts`、`test/manifest.test.ts`：覆盖新增 debug 入口契约。

## 实现思路与设计取舍

- Debug 入口不直接执行 `go test`，而是生成 VSCode Go 调试配置并交给官方 Go 调试适配器。
- 调试配置使用 `mode: "test"`，`program` 和 `cwd` 指向 package 目录，`args` 使用 `['-test.run=<pattern>']`。
- `pattern` 由 runner 的 `buildRunPattern` 构造，和 Run 入口保持同一套空白、斜杠和正则转义规则。
- CodeLens 的显示开关沿用现有 `showFunctionRun` 和 `showCaseRun`：如果某类运行入口不显示，对应 Debug 入口也不显示。
- Test Explorer 调试合集节点时，只启动合集节点对应的测试函数调试会话，不为子 case 重复启动多个调试会话。
- 调试启动失败时通过 VSCode error message 告知用户，并在 `Go Bench` output channel 写入 debug configuration 和错误。

## 当前插件内可进行的操作

- 打开 Go `_test.go` 文件：函数级 CodeLens 显示 `Run Test` 和 `Debug Test`。
- 对可解析 table case：case 位置显示 `Run Case` 和 `Debug Case`。
- 点击 `Debug Test`：启动目标测试函数的 Go test debug session。
- 点击 `Debug Case`：启动目标 table case 的 Go test debug session。
- 启用 `goBench.tableTests.testingApi.enabled` 后：Test Explorer 中 `Go Bench Table Tests` 提供 Run 和 Debug profile。
- 从 Test Explorer 调试函数节点或 case 节点：启动对应 Go test debug session。
- 无法确定 workspace folder、Go 调试环境缺失或 debug adapter 启动失败时：插件显示错误，并在 `Go Bench` output channel 保留诊断。

## 当前可进行操作

### 编译扩展

- 用途：验证新增 debug 命令、CodeLens target 和 Testing API Debug profile 类型正确。
- 命令：`npm run compile`
- 预期结果：`tsc -p ./` 通过。
- 失败优先检查：`vscode.debug.startDebugging` 参数、`TestRunProfileKind.Debug`、`GoTestDebugConfiguration` 类型。

### 运行完整自动化测试

- 用途：验证 parser、runner、CodeLens、Testing API 树模型和 debug 配置构造。
- 命令：`npm test`
- 预期结果：当前通过 40 个断言，全部通过。
- 失败优先检查：CodeLens target 顺序、manifest 命令贡献、`-test.run` pattern。

### 运行 lint

- 用途：验证新增 debug 代码和文档相关 TypeScript 变更风格。
- 命令：`npm run lint`
- 预期结果：ESLint 无报错。
- 失败优先检查：新增 helper 函数返回类型、未使用导入、异步命令回调。

### 手动验证 Debug CodeLens

- 用途：确认编辑器调试入口能启动目标测试。
- 入口：打开 Go `_test.go` 文件，点击 `Debug Test` 或 `Debug Case`。
- 预期结果：VSCode 启动 Go debug session，目标测试函数或 table case 被调试。
- 失败优先检查：官方 Go 扩展是否安装、Delve 是否可用、output channel 中的 debug configuration 是否包含正确 `-test.run=<pattern>`。

### 手动验证 Test Explorer Debug

- 用途：确认 Testing API 测试树也提供调试入口。
- 入口：启用 `goBench.tableTests.testingApi.enabled`，刷新 Test Explorer，选择 `Go Bench Table Tests` 下的函数节点或 case 节点并执行 Debug。
- 预期结果：VSCode 启动与节点匹配的 Go test debug session。
- 失败优先检查：Testing API 是否启用、测试树是否刷新、目标节点是否来自 Go Bench controller。

## 测试记录

- 日期：2026-06-19
- 命令：`npm test`
  - 结果：通过，Node test 运行 40 个断言，全部通过。
- 命令：`npm run lint`
  - 结果：通过，ESLint 未报告问题。

## 已知问题和后续计划

- 当前仍缺少 Extension Host e2e 自动化测试，真实 debug session 需要手动验证。
- Debug 入口依赖官方 Go 扩展和 Delve；缺失时只能由 VSCode debug API 返回启动失败。
- 暂未增加独立 debug 显示开关；Debug 入口跟随现有 Run 入口显示开关。
- coverage profile 尚未实现，后续可在 Testing API 中继续扩展。
