# 里程碑 2 工作文档：table case 识别

## 完成功能范围

- 在 parser 结果中为每个 `GoTestFunctionMetadata` 增加 `tableCases`。
- 识别测试函数内部本地 table 变量，并提取可静态解析的 case 名称。
- 解析 `for range` 的 key/value 变量与 table entry 的映射关系。
- 将 `t.Run(tt.name, ...)`、`t.Run(tc.desc, ...)`、`t.Run(item.title, ...)` 等 selector 名称回溯到 table entry。
- 支持 range 表达式中的 inline table literal。
- 支持 `map[string]...` table，并在 `t.Run(name, ...)` 使用 range key 时生成 case。
- 为每个已识别 case 输出 `id`、`label`、`file`、`testName`、`subtestName`、`subtestPath`、`range` 和 `confidence`。
- 对动态名称、helper 生成名称和无法静态回溯的表达式保持静默跳过。

## 核心文件和模块

- `src/parser/types.ts`：新增 `TableTestCaseMetadata`、`TableTestCaseConfidence`，并将 `tableCases` 挂到测试函数元数据下。
- `src/parser/goHelperParser.ts`：把 `nameFields` 传给 Go helper，默认值来自 `goBench.tableTests.nameFields` 的项目默认配置。
- `src/parser/helperSource.ts`：实现 table detector 和 locator，包括 table literal 解析、range 绑定、`t.Run` 名称表达式回溯和 source range 生成。
- `src/parser/index.ts`：导出新增 table case 类型。
- `test/parser.test.ts`：新增 table case detector/locator 单元测试。
- `test/fixtures/parser/table_cases_test.go`：新增里程碑 2 fixture，覆盖已支持模式和动态名称跳过场景。

## 实现思路与设计取舍

- 继续使用 Go helper 方案：table-driven test 识别依赖 Go AST，直接在 helper 中实现能复用 `go/ast` 节点类型和已有 token position 映射。
- `tableCases` 挂在测试函数下：当前阶段不引入独立 detector API，减少 VSCode 层调用复杂度；后续如需要单独缓存或配置刷新，可再抽出更明确的 detector 接口。
- 只产出可安全运行的 case：`confidence` 当前统一为 `exact`，动态或不支持场景不返回 `unsupported` 记录，避免里程碑 3 的 CodeLens provider 误显示入口。
- 顶层收集本地 table 变量：避免不同 block 里的同名变量遮蔽导致错误映射。复杂作用域后续需要建立 scope model 后再支持。
- source range 优先定位 table entry：keyed/positional struct entry 定位到 `{...}`，map table 定位到 `"case": {...}` 的 key-value entry，符合产品中“case name 声明在 table entry 中优先定位 table entry”的要求。
- `nameFields` 由 TypeScript wrapper 传入 helper：当前默认使用 `["name", "desc", "caseName", "title"]`，为后续接入 VSCode 用户配置保留入口。

## 已支持模式矩阵

| 模式 | 示例 | 状态 |
| --- | --- | --- |
| 本地 keyed struct table | `{name: "empty"}` + `t.Run(tt.name, ...)` | 已支持 |
| 默认名称字段 | `name`、`desc`、`caseName`、`title` | 已支持 |
| positional struct entry | `{"first", 1}` + struct 字段顺序 | 已支持 |
| inline table literal | `for _, tt := range []struct{ caseName string }{...}` | 已支持 |
| map-based table | `map[string]struct{...}` + `t.Run(name, ...)` | 已支持 |
| 动态名称 | `fmt.Sprintf(...)` | 不支持，静默跳过 |
| helper 生成名称 | `t.Run(makeName(tt.name), ...)` | 不支持，静默跳过 |
| 非字符串 table 名称 | 变量引用、拼接、非字面量 | 不支持，静默跳过 |
| 复杂嵌套作用域 | block 内同名 table 或跨 block 映射 | 不支持，避免遮蔽误判 |
| nested subtests | `t.Run(parent, func...)` 内再次 `t.Run(child, ...)` | 暂未建模，留到后续 subtest path 扩展 |

## 测试记录

- 命令：`npm test`
  - 结果：通过，Node test 运行 16 个断言，全部通过。
- 命令：`npm run lint`
  - 结果：通过，ESLint 未报告问题。

## 未覆盖风险

- 当前 fixture 未覆盖 import alias 下的 `*testing.T`，沿用里程碑 1 的限制。
- 当前 detector 使用函数体顶层语句顺序建模，尚未覆盖嵌套 block 中声明 table 后立即 range 的模式。
- 当前 `ast.Inspect` 会扫描 range body 内所有 `t.Run`，nested subtests 未来需要更精细的 path 建模，避免同一层 case 与子 case 混淆。
- helper 仍通过 `go run` 启动，性能风险与里程碑 1 一致，后续 CodeLens 刷新时需要配合 debounce 和缓存。

## 已知问题和后续计划

- 已知问题：`confidence` 类型预留了 `probable`，但本阶段只返回 `exact`；不支持场景直接跳过。
- 后续计划：里程碑 3 接入 CodeLens provider，消费 `tableCases` 并显示 `Run Case`。
- 后续计划：实现 runner 后为 `subtestPath` 构造 `go test -run` 正则路径，并补充特殊字符转义测试。
- 后续计划：接入 VSCode 配置读取，让用户修改 `goBench.tableTests.nameFields` 后能影响 helper 识别结果。
