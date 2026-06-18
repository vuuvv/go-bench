# 里程碑 3 工作文档：CodeLens 运行入口

## 完成功能范围

- 添加 Go `_test.go` 文件 CodeLens provider。
- 在测试函数名位置展示函数级 `Run Test` 入口。
- 在已解析 table entry 位置展示 case 级 `Run Case` 入口。
- 新增 `goBench.runTest` 命令，点击 CodeLens 后执行标准 `go test -run`。
- 实现 runner 纯函数：正则字面量转义、Go subtest path 构造、workspace 内 package 参数解析、shell 展示命令构造。
- 使用 VSCode output channel 展示触发目标、实际命令和 `go test` 原始 stdout/stderr。
- 接入 `goBench.tableTests.enabled`、`nameFields`、`showFunctionRun`、`showCaseRun` 配置。
- 为 CodeLens 目标生成、runner 命令构造和配置归一化补充自动化测试。

## 核心文件和模块

- `src/extension.ts`：注册 output channel、`goBench.runTest` 命令和 Go 测试文件 CodeLens provider。
- `src/codelens.ts`：把 parser 结果转换为 VSCode `CodeLens`，并处理解析失败时的静默降级。
- `src/codelensTargets.ts`：不依赖 VSCode API 的 CodeLens 目标生成纯函数，便于单元测试覆盖入口参数。
- `src/runner.ts`：构造和执行 `go test <package> -run <pattern>`，保留 Go 原始输出。
- `src/tableTestConfig.ts`：归一化 VSCode 用户配置，保护配置类型错误和空字段列表。
- `src/constants.ts`、`package.json`：新增 `goBench.runTest` 命令 ID 和 manifest 贡献。
- `test/runner.test.ts`：覆盖空格、斜杠、标点、正则特殊字符、package 路径和 shell 命令展示。
- `test/codelensTargets.test.ts`：覆盖函数级和 case 级 CodeLens 目标生成及显示开关。
- `test/tableTestConfig.test.ts`：覆盖配置默认值、用户值和异常值兜底。

## 实现思路与设计取舍

- CodeLens provider 只做 VSCode 适配：核心入口描述放在 `codelensTargets` 纯函数中，减少 Extension Host 测试成本。
- runner 用 `spawn(go, ["test", packageArg, "-run", pattern])` 执行，而不是拼 shell 字符串执行，避免 `$`、空格、引号和正则字符被 shell 二次解释。
- output channel 会展示可粘贴的 shell 命令，但实际执行使用 argv 数组；两者职责不同，测试分别保护 pattern 和展示命令。
- `-run` pattern 每段都使用 `^...$`，避免相似测试名或 case 名被误匹配。
- package 参数以 workspace root 为 cwd 解析：根目录使用 `.`，子目录使用 `./relative/path`，workspace 外目录直接报错。
- 用户配置每次 CodeLens 刷新时读取，`nameFields` 会传给 Go helper parser，便于修改配置后影响 table case 识别。
- 当前阶段未实现 debounce 和缓存失效；这些属于里程碑 4 稳定性增强，现阶段每次 VSCode 请求 CodeLens 时直接解析当前 document 文本。

## 已支持行为

| 行为 | 状态 |
| --- | --- |
| `_test.go` 文件函数级 `Run Test` CodeLens | 已支持 |
| 可静态解析 table case 的 `Run Case` CodeLens | 已支持 |
| 点击函数级入口运行 `go test ./pkg -run '^TestName$'` | 已支持 |
| 点击 case 级入口运行 `go test ./pkg -run '^TestName$/^case name$'` | 已支持 |
| 名称中的空格和标点 | 已支持 |
| 名称中的正则特殊字符 | 已按字面量转义 |
| 名称中的 `/` | 保留 Go subtest 路径语义 |
| `go test` 输出查看 | 输出到 `Go Bench` output channel |
| 动态或不支持 case | 沿用里程碑 2 策略，不生成 case 入口 |

## 当前插件内可进行的操作

- 打开 Go 测试文件：在 Extension Development Host 中打开任意 `_test.go` 文件，插件会尝试识别普通 `func TestXxx(t *testing.T)`。
- 查看函数级运行入口：当 `goBench.tableTests.showFunctionRun` 为 `true` 时，可以在测试函数名附近看到 `Run Test` CodeLens。
- 运行整个测试函数：点击 `Run Test` 后，插件会在当前 workspace root 下执行类似 `go test ./pkg -run '^TestName$'` 的命令。
- 查看 table case 运行入口：对里程碑 2 已支持的静态 table-driven case，可以在 table entry 附近看到 `Run Case` CodeLens。
- 运行单个 table case：点击 `Run Case` 后，插件会执行类似 `go test ./pkg -run '^TestName$/^case name$'` 的命令，只选择对应 subtest path。
- 查看运行输出：每次运行会打开或写入 `Go Bench` output channel，显示目标名称、可复现命令和 Go 工具链原始输出。
- 控制入口显示：可以通过 `goBench.tableTests.enabled` 总开关启用或禁用识别，通过 `showFunctionRun` 和 `showCaseRun` 分别控制函数级与 case 级 CodeLens。
- 扩展可识别名称字段：可以修改 `goBench.tableTests.nameFields`，让 parser 把 `name`、`desc`、`caseName`、`title` 之外的静态字符串字段也视作 case 名称。
- 安全忽略不支持 case：动态拼接、helper 生成名称或无法静态回溯的 case 不会显示 `Run Case`，避免点击后运行错误目标。

## 明确不支持或未完成

- 尚未实现 debounce、缓存和文档变更事件主动刷新策略，等待里程碑 4。
- 尚未实现 VSCode Testing API 测试树，等待里程碑 5 评估。
- 尚未实现 debug action，本阶段只有运行入口。
- 尚未补充真正启动 Extension Development Host 的端到端自动化测试；当前以纯函数测试和 TypeScript 编译保护集成入口。
- 如果 Go 工具链不可用，runner 会在 output channel 中记录启动错误并显示 VSCode 错误提示。

## 测试记录

- 命令：`npm test`
  - 结果：通过，Node test 运行 25 个断言，全部通过。
- 命令：`npm run lint`
  - 结果：通过，ESLint 未报告问题。

## 当前可进行操作

### 安装依赖

- 用途：恢复本项目 TypeScript、ESLint 和 VSCode 类型依赖。
- 命令：`npm install`
- 预期结果：生成或更新 `node_modules`，后续 `npm test` 可以运行。
- 失败优先检查：Node/npm 版本、网络访问、package lock 是否被外部修改。

### 编译扩展

- 用途：验证 TypeScript 源码和 VSCode API 类型是否匹配。
- 命令：`npm run compile`
- 预期结果：`tsc -p ./` 通过，并在 `out` 目录生成编译产物。
- 失败优先检查：新增模块导入路径、显式返回类型、`@types/vscode` API 版本。

### 运行完整自动化测试

- 用途：验证 manifest、配置、parser、CodeLens 目标生成和 runner 命令构造。
- 命令：`npm test`
- 预期结果：先编译，再通过 Node test 执行 `out/test/**/*.test.js`，当前应通过 25 个断言。
- 失败优先检查：Go 工具链是否可用、fixture 路径是否变化、命令字符串转义断言是否与实现不一致。

### 运行 lint

- 用途：验证 TypeScript 代码风格和显式返回类型要求。
- 命令：`npm run lint`
- 预期结果：ESLint 无报错。
- 失败优先检查：新增公开函数是否声明返回类型、未使用变量、测试文件注释或导入是否过期。

### 启动 Extension Development Host

- 用途：在 VSCode 里手动验证 CodeLens 和 runner。
- 入口：在 VSCode 打开本仓库，运行 `npm run compile` 后按 `F5` 启动 Extension Development Host。
- 预期结果：打开 Go `_test.go` 文件后，测试函数位置出现 `Run Test`，已识别 table entry 位置出现 `Run Case`。
- 失败优先检查：Extension Host 是否加载本仓库、`package.json` activation events 是否生效、当前文件是否以 `_test.go` 结尾。

### 手动验证 CodeLens 运行

- 用途：确认点击入口后只运行目标函数或目标 case。
- 入口：在 Extension Development Host 中打开包含 table-driven tests 的 Go 项目，点击 `Run Test` 或 `Run Case`。
- 预期结果：`Go Bench` output channel 显示类似 `go test ./pkg -run '^TestName$/^case name$'` 的命令，并保留 Go 原始输出。
- 失败优先检查：本机 `go` 是否在 PATH 中、测试文件是否位于当前 workspace 内、case 是否属于里程碑 2 已支持的静态模式。

### 调整显示配置

- 用途：验证 CodeLens 显示开关和名称字段配置。
- 入口：在 VSCode settings 中修改 `goBench.tableTests.enabled`、`goBench.tableTests.nameFields`、`goBench.tableTests.showFunctionRun` 或 `goBench.tableTests.showCaseRun`。
- 预期结果：刷新或重新打开 `_test.go` 文件后，CodeLens 根据配置显示或隐藏。
- 失败优先检查：配置值类型是否正确、字段名是否为空字符串、当前 case 是否使用静态字符串字段。

## 已知问题和后续计划

- 里程碑 4 应加入 debounce 和缓存，降低频繁编辑时的 `go run` helper 调用成本。
- 里程碑 4 应补充更完整的不支持模式 fixture，并确保不产生误导性 CodeLens。
- 里程碑 5 评估是否引入 VSCode Testing API，把当前 `GoTestRunTarget` 复用于测试树 item。
- 后续可考虑将 Go helper 从 `go run` 改为预编译或长期进程，进一步降低 CodeLens 刷新延迟。
