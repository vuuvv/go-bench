# VSCode Testing API 评估

## 评估结论

建议 v0.1 不默认包含 VSCode Testing API 测试树，继续以 CodeLens 作为主入口。Testing API 原型保留为实验能力，通过 `goBench.tableTests.testingApi.enabled` 手动开启，用于后续验证测试树 UX、运行状态呈现和与官方 Go 插件的共存策略。

## 原型范围

- 使用 `vscode.tests.createTestController` 创建 `Go Bench Table Tests` 测试控制器。
- 将 parser 输出的 `TestXxx` 函数映射为测试树根节点。
- 将可静态解析的 table case 映射为函数节点下的子节点。
- 复用现有 `GoTestRunTarget` 和 `runGoTestTarget`，运行行为与 CodeLens 保持一致。
- 支持文档编辑、保存和配置变化后的测试树刷新。
- 使用 `goBench.tableTests.testingApi.enabled` 控制开关，默认关闭。
- 使用 `Go Bench: Refresh Test Tree` 命令或 Test Explorer refresh 按钮重新扫描整个 workspace。

## UX 对比

| 维度 | CodeLens | Testing API 原型 |
| --- | --- | --- |
| 入口位置 | 贴近源码函数和 table entry | Test Explorer 测试树 |
| 单 case 可见性 | case 所在源码附近直接显示 | 需要打开测试树层级 |
| 与官方 Go 插件重叠 | 较低，主要补 table case 入口 | 较高，可能与官方测试树重复 |
| 运行结果呈现 | `Go Bench` output channel | Test Explorer 状态 + Test Results 输出，Output Channel 作为补充诊断 |
| 当前实现成熟度 | 已作为主路径验证 | 原型可用，已支持合集子状态映射，缺少 Extension Host e2e |
| v0.1 风险 | 低 | 中等，需继续验证共存和刷新成本 |

## 设计取舍

- Testing API 原型默认关闭，避免用户在 v0.1 阶段看到两套测试入口造成困惑。
- 测试树节点模型放在 `src/testingTargets.ts`，不依赖 VSCode API，便于单元测试覆盖。
- `src/testing.ts` 只做 VSCode 适配：创建 controller、刷新文档节点、处理 Test Explorer 运行请求。
- 测试树运行复用 runner 的命令构造和执行能力；Testing API 路径额外启用 `go test -json`，用于把结果映射回子测试节点。
- 运行父节点时只执行一次父函数目标，同时展开已注册子 case 的 Testing API 状态，避免重复运行同一个测试函数和 case。
- 当前不实现 debug profile、coverage profile 和 nested subtest path 展示，防止原型范围膨胀。

## 已验证内容

- `npm test` 覆盖 Testing API 纯树模型：
  - 函数节点 ID、label、range 和 runner target。
  - table case 子节点 ID、label 和 subtest path。
  - `showFunctionRun`、`showCaseRun` 显示开关。
  - `go test -json` event 解析、chunk 边界和 Go test name 映射。
  - runner `-json` 命令构造。
- `npm run lint` 覆盖新增 TypeScript 代码风格。
- `npm run compile` 由 `npm test` 触发，验证 `vscode.TestController`、`TestRunProfile`、`TestRunRequest` 等 API 类型可编译。

## 当前限制

- 尚未建立 Extension Host 端到端自动化测试，Test Explorer 真实 UI 仍需手动验证。
- 项目级刷新已支持扫描整个 workspace，但尚未做大项目性能评估和进度提示。
- 与官方 Go 插件 Testing API 的共存策略还没有真实用户反馈。
- 失败详情已写入 Test Results；无法映射到具体 `TestItem` 的动态或工具链输出会写入本次 test run 的全局输出。
- nested subtests 仍未建模，当前 table case 只支持 parser 已识别的一层 subtest path。

## 最终建议

v0.1 保持 CodeLens 为默认能力，Testing API 延后到 v0.2 或后续版本再决定是否正式启用。保留实验开关的价值是让维护者可以在真实项目中收集反馈，同时不增加默认 UX 噪声。

进入正式默认启用前，建议补齐：

- Extension Host e2e：打开 fixture 文件后 Test Explorer 出现函数和 case。
- Extension Host e2e：点击测试树函数节点和 case 节点时，验证只运行对应目标，并确认子测试状态图标与 Test Results 输出。
- 与官方 Go 插件同时启用时的入口重复、命名和运行结果体验评估。
- 大项目性能测试、进度提示和可取消刷新体验。
