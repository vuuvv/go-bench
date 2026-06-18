# 里程碑 5 工作文档：VSCode Testing API 评估

## 完成功能范围

- 新增实验配置 `goBench.tableTests.testingApi.enabled`，默认关闭。
- 新增 Testing API 纯树模型，将 parser 结果转换为函数节点和 table case 子节点。
- 新增 VSCode Testing API 原型适配层，按配置创建 `Go Bench Table Tests` controller。
- Test Explorer 运行请求复用现有 `go test -run` runner，与 CodeLens 保持同一执行路径。
- 文档编辑、保存和配置变化时刷新实验测试树。
- 补充 Testing API 树模型单元测试、manifest/config 测试。
- 输出 Testing API 评估文档，明确 v0.1 建议继续默认使用 CodeLens，Testing API 暂作为实验能力保留。

## 核心文件和模块

- `src/testingTargets.ts`：无 VSCode 依赖的测试树模型生成函数，便于单元测试和后续复用。
- `src/testing.ts`：VSCode `TestController` 原型适配层，负责创建测试树、响应运行请求和释放资源。
- `src/extension.ts`：接入 Testing API 原型 manager，并在文档与配置事件中刷新。
- `src/constants.ts`、`src/tableTestConfig.ts`、`package.json`：新增实验配置键和默认值。
- `test/testingTargets.test.ts`：覆盖函数节点、case 子节点、runner target 和显示开关。
- `test/constants.test.ts`、`test/tableTestConfig.test.ts`、`test/manifest.test.ts`：覆盖新增配置契约。
- `docs/testing-api-evaluation.md`：记录 UX 对比、原型范围、限制和 v0.1 决策。

## 实现思路与设计取舍

- Testing API 默认关闭，避免 v0.1 阶段和官方 Go 插件测试树重复，CodeLens 仍是主路径。
- 树模型和 VSCode API 适配分离：`testingTargets` 只产出纯数据，`testing` 只处理 `TestItem` 和 `TestRun`。
- 运行逻辑复用 `GoTestRunTarget` 和 `runGoTestTarget`，不新增第二套命令构造。
- 父函数节点和 case 节点都可运行；运行父节点只执行该测试函数，不自动重复执行所有子 case。
- 原型只刷新已打开文档，不做 workspace 全量扫描，避免评估阶段引入额外性能和状态复杂度。
- 当前不提供 debug/coverage profile，Testing API 只评估 run profile 的信息架构和交互价值。

## 当前插件内可进行的操作

- 默认行为：不显示 Go Bench Testing API 测试树，继续使用 CodeLens 的 `Run Test` 和 `Run Case`。
- 启用实验测试树：在 VSCode settings 中设置 `goBench.tableTests.testingApi.enabled` 为 `true`。
- 查看测试树：启用后打开 Go `_test.go` 文件，Test Explorer 会出现 `Go Bench Table Tests` 下的测试函数和可解析 table case。
- 运行函数节点：在 Test Explorer 中运行 `TestXxx` 节点，会复用 runner 执行整个测试函数。
- 运行 case 节点：运行 table case 子节点，会执行对应 `go test -run` subtest path。
- 查看输出：运行过程和 Go 原始 stdout/stderr 仍写入 `Go Bench` output channel，Test Explorer 显示通过或失败状态。
- 关闭实验测试树：将 `goBench.tableTests.testingApi.enabled` 改回 `false`，插件会释放 controller；CodeLens 不受影响。
- 安全忽略不支持 case：Testing API 与 CodeLens 使用同一 parser 结果，动态或不支持 case 不会出现在测试树中。

## 当前可进行操作

### 安装依赖

- 用途：恢复 TypeScript、ESLint 和 VSCode 类型依赖。
- 命令：`npm install`
- 预期结果：生成或更新 `node_modules`，后续编译和测试可运行。
- 失败优先检查：Node/npm 版本、网络访问、`package-lock.json` 是否被外部修改。

### 编译扩展

- 用途：验证新增 Testing API 适配层与 VSCode API 类型兼容。
- 命令：`npm run compile`
- 预期结果：`tsc -p ./` 通过。
- 失败优先检查：`vscode.TestController`、`TestRunProfile`、`TestRunRequest` 类型使用是否与 `@types/vscode` 版本匹配。

### 运行完整自动化测试

- 用途：验证 parser、runner、CodeLens、缓存、Testing API 纯树模型和 manifest/config 契约。
- 命令：`npm test`
- 预期结果：当前通过 34 个断言。
- 失败优先检查：新增配置默认值是否同步到 `package.json`，Testing API tree node 断言是否与 runner target 一致。

### 运行 lint

- 用途：验证新增 Testing API 代码和注释后的 TypeScript 风格。
- 命令：`npm run lint`
- 预期结果：ESLint 无报错。
- 失败优先检查：公开函数返回类型、未使用导入、异步回调是否显式处理。

### 手动启用 Testing API 原型

- 用途：在 VSCode Test Explorer 中验证测试树 UX。
- 入口：在 VSCode settings 设置 `goBench.tableTests.testingApi.enabled` 为 `true`，然后打开 `_test.go` 文件。
- 预期结果：Test Explorer 显示 `Go Bench Table Tests`，包含测试函数节点和静态可解析的 table case 子节点。
- 失败优先检查：配置是否生效、文件是否已打开、`goBench.tableTests.enabled` 是否为 `true`、output channel 是否有 parser 诊断。

### 手动运行测试树节点

- 用途：确认 Testing API 运行路径与 CodeLens 一致。
- 入口：在 Test Explorer 中点击函数节点或 case 子节点的 run。
- 预期结果：Test Explorer 显示通过或失败状态，`Go Bench` output channel 显示实际 `go test` 命令和原始输出。
- 失败优先检查：Go 是否在 PATH 中、测试文件是否位于 workspace 内、case 是否属于已支持静态模式。

## 测试记录

- 日期：2026-06-18
- 命令：`npm test`
  - 结果：通过，Node test 运行 34 个断言，全部通过。
- 命令：`npm run lint`
  - 结果：通过，ESLint 未报告问题。

## 决策与后续计划

- 决策：v0.1 不默认启用 Testing API，继续以 CodeLens 作为用户主入口。
- 决策：Testing API 原型保留为默认关闭的实验能力，供维护者继续评估。
- 后续计划：补充 Extension Host e2e，验证打开 fixture 后 Test Explorer 的真实 UI。
- 后续计划：评估与官方 Go 插件测试树同时启用时的重复入口和命名策略。
- 后续计划：如准备正式启用 Testing API，再补 workspace 扫描、debug/coverage profile 和 nested subtest path 模型。
