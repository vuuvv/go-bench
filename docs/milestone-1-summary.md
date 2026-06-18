# 里程碑 1 工作文档：parser 方案验证

## 完成功能范围

- 新增 parser 抽象，用于把 `_test.go` 文件文本解析成结构化测试函数元数据。
- 使用 Go 官方 `go/parser` 和 `go/ast` 实现 helper 方案验证。
- 返回测试函数名、文件路径、函数范围、函数名范围和 package 名称。
- 将 Go token offset 映射为 VSCode 兼容的 zero-based `line` / `character` range。
- 对语法未完成文件返回可恢复诊断，允许保留 Go parser 能恢复出的部分 AST 结果。
- 过滤非 `_test.go` 文件，避免普通 Go 文件产生测试入口噪声或额外子进程开销。

## 核心文件和模块

- `src/parser/types.ts`：定义 parser 输入输出模型、源码位置模型和 `GoTestParser` 抽象。
- `src/parser/helperSource.ts`：内嵌 Go helper 源码，使用官方 Go parser 提取测试函数元数据。
- `src/parser/goHelperParser.ts`：负责写入临时 helper 文件、调用 `go run`、传递未保存源码并解析 JSON 输出。
- `src/parser/index.ts`：parser 模块公共出口，隐藏内部文件布局。
- `test/parser.test.ts`：覆盖 parser 第一阶段关键行为。
- `test/fixtures/parser/*.go`：提供正常测试函数、非测试文件和语法未完成文件 fixtures。

## 实现思路与设计取舍

- 采用 Go helper 而不是 TypeScript Go parser：官方 `go/parser` 与 Go 语言版本保持同步，token 位置和错误恢复行为更可信。
- helper 源码以内嵌 TypeScript 字符串保存：第一阶段不引入预编译 binary，也不依赖额外打包复制 `.go` 文件，扩展运行时可直接写入系统临时目录。
- wrapper 通过 stdin 传源码：后续接入 VSCode document 时可以解析未保存 buffer，而不是只能解析磁盘文件。
- helper 文件按源码 hash 写入临时目录：重复解析复用同一路径，减少写入和 `go run` 缓存抖动。
- 位置映射使用 token offset 重新计算 UTF-16 character：比直接使用 Go 的 byte column 更贴近 VSCode `Position.character` 语义。
- 当前阶段只识别顶层 `func Test...(t *testing.T)`：benchmark、fuzz、方法 receiver 和参数不兼容函数都跳过，避免提前暴露不可运行入口。

## 已支持和不支持的模式

已支持：

- `_test.go` 文件中的顶层 `func TestName(t *testing.T)`。
- 同一文件内多个测试函数，按源码顺序返回。
- 测试函数和函数名的 VSCode range。
- 语法未完成文件的诊断返回和部分 AST 保留。
- 非 `_test.go` 文件的安全跳过。

暂不支持：

- table case 识别、`t.Run` 解析和 case range 定位；这些属于里程碑 2。
- benchmark、fuzz test 和 testing helper 方法识别。
- import alias 下的 `*testing.T` 兼容判断。
- 预编译 helper binary 或长期运行的 helper server；当前仍以 `go run` 验证方案。
- VSCode CodeLens 或 Testing API 集成；这些属于后续里程碑。

## 测试记录

- 命令：`npm test`
  - 结果：通过，Node test 运行 11 个断言，全部通过。
- 命令：`npm run lint`
  - 结果：通过，ESLint 未报告问题。

未覆盖风险：

- 当前测试尚未覆盖非 ASCII 标识符或注释附近的 UTF-16 range，但实现已按 UTF-16 code unit 映射。
- 当前未在真实 VSCode Extension Host 中验证 parser 调用链，因为 CodeLens 尚未接入。
- 当前 helper 依赖本机可用的 Go 工具链；后续需要决定是否随扩展发布预编译 helper，或继续依赖用户环境中的 `go`。

## 已知问题和后续计划

- 已知问题：每次解析会通过 `go run` 启动子进程，适合方案验证但不是最终性能形态。
- 后续计划：里程碑 2 在 parser 结果和 Go AST helper 基础上识别本地 table 变量、`for range` 映射和 `t.Run(tt.name, ...)`。
- 后续计划：里程碑 3 接入 CodeLens 和 runner 后，需要把 parser 诊断与刷新策略串入 VSCode 生命周期。
- 待确认问题：是否在 v0.1 前将 helper 编译为随扩展分发的 per-platform binary，以降低首次解析延迟。
