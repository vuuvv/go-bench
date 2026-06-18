# Go Bench

[English](README.md) | 中文

Go Bench 是一个增强 VSCode Go 测试体验的插件，重点解决
table-driven tests 中单个 case 难以直接运行的问题。它不会替代官方
Go 插件，而是复用标准 Go 工具链和 VSCode Testing API，在编辑器
CodeLens 与 Test Explorer 中提供更细粒度的运行、调试和结果展示入口。

## 核心能力

- 在 Go `TestXxx` 函数上显示 `Run Test` 和 `Debug Test` CodeLens。
- 在可静态识别的 table-driven case 上显示 `Run Case` 和 `Debug Case` CodeLens。
- 生成标准 `go test <package> -run <pattern>` 命令，按 Go subtest 规则转义测试名、空白字符、斜杠和正则特殊字符。
- 默认启用 VSCode Test Explorer 集成，测试树名称为 `Go Bench`。
- Test Explorer 默认使用 Go Bench 增强树：`module path -> relative package directory -> *_test.go -> TestXxx -> table case`。
- 运行结果写入 VSCode Test Results，`Go Bench` output channel 保留命令、原始输出和诊断信息。
- 支持从 Test Explorer 运行或调试函数节点、case 节点，以及 package/file/module 等结构节点。

## 需求

- VSCode 1.90.0 或更新版本。
- 本机 `PATH` 中可用的 Go 工具链。
- 推荐安装官方 Go 扩展；调试入口依赖官方 Go debug adapter 和 Delve。
- 测试文件必须以 `_test.go` 结尾。
- 要出现在 Go Bench Test Explorer 中，测试文件必须位于有效 Go module 内，也就是上级目录中存在包含 `module ...` 声明的 `go.mod`。

## 支持的测试模式

Go Bench 当前聚焦常见的本地 table-driven tests：

```go
func TestNormalize(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "empty", input: "", want: ""},
		{name: "simple", input: "a", want: "a"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// assertions
		})
	}
}
```

已支持：

- 函数名以 `Test` 开头、参数兼容 `*testing.T` 的普通 Go 测试函数。
- 测试函数内部声明的本地 table 变量。
- struct composite literal table。
- `name`、`desc`、`caseName`、`title` 等稳定字符串字段。
- `for range` 遍历 table 变量。
- `t.Run(tt.name, func(t *testing.T) { ... })` 形式的 subtest。
- 可安全解析字段顺序时的 positional struct value。
- 使用字符串 map key 作为 subtest 名称的 map-based table。

有意不支持：

- 运行时生成的 case name，例如 `fmt.Sprintf`、字符串拼接或 helper function 返回值。
- 从文件、网络或其他运行时数据源加载的 table。
- 映射关系不明确的多个 table/range 变量组合。
- benchmark 和 fuzz test 的一等支持。

无法安全解析的 case 不会显示 case 级运行入口，避免运行到错误目标。

## Test Explorer 树

默认开启 `goBench.tableTests.testingApi.enabled` 后，Test Explorer 会显示一个
`Go Bench` 测试控制器。默认树模式为 `goBench`：

```text
Go Bench
└── example.com/project
    └── internal/normalize
        └── normalize_test.go
            └── TestNormalize
                ├── empty
                └── simple
```

层级说明：

- `Go Bench` 是插件测试控制器名称。
- 第一层是有效 Go module，展示 `go.mod` 中的 module path，不展示目录名。
- module 下级是相对 module 根目录的 package/directory，不带 `./` 前缀；module 根目录显示为 `.`。
- package/directory 下是 `_test.go` 文件。
- 文件下是 `TestXxx` 函数。
- 在 `goBench` 树模式下，函数下继续显示可识别的 table case。

如果切换到 `standardGo` 树模式，结构仍然按 module、目录、文件、测试函数组织，但不会展开 Go Bench 特有的 table case 节点，更接近官方 Go 插件的函数级测试树。

## 命令

### `Go Bench: Run Test`

运行一个 Go Bench 目标测试。通常由 CodeLens 或 Test Explorer 调用，不建议从命令面板手动执行，因为命令需要携带具体测试目标。

行为：

- 函数目标运行整个 `TestXxx`。
- case 目标运行对应的 `TestXxx/subtest`。
- 使用 `go test -json` 并创建 Testing API `TestRun`。
- 输出和失败详情进入 VSCode Test Results。
- `Go Bench` output channel 会记录实际命令和诊断信息。

### `Go Bench: Debug Test`

调试一个 Go Bench 目标测试。通常由 CodeLens 或 Test Explorer 调用。

行为：

- 使用 VSCode debug API 启动官方 Go debug adapter。
- 调试配置使用 `type: "go"`、`request: "launch"`、`mode: "test"`。
- 通过 `["-test.run", pattern]` 传入测试过滤条件。
- 函数目标只调试目标 `TestXxx`。
- case 目标只调试对应 table case。
- 如果 VSCode 接受 debug request 但没有实际启动 session，会显示 warning。

### `Go Bench: Refresh Test Tree`

重新扫描当前 workspace 中的 Go `_test.go` 文件，并重建 `Go Bench` Test Explorer 树。

适合在以下情况使用：

- 新增、删除或移动测试文件后。
- 修改 `go.mod` module path 后。
- 修改配置后希望立即重建测试树。
- Test Explorer 中节点看起来过期时。

如果 `goBench.tableTests.testingApi.enabled` 被关闭，命令会提示先启用 Test Explorer 集成。

### `Go Bench: Refresh Current File Test Tree`

只刷新当前 Go `_test.go` 文件在 Test Explorer 中的节点。

入口：

- 命令面板。
- Go 测试文件顶部的 `Refresh Test Tree` CodeLens。

行为：

- 当前文件必须是 `_test.go`。
- 当前文件必须位于有效 Go module 内。
- 只替换当前文件对应的 file/function/case 子树。
- 其他文件节点不会被全量清空。

### `Go Bench: Toggle Test Tree Mode`

在两种 Test Explorer 树模式之间切换：

- `goBench`：默认模式，显示 table-driven case 节点。
- `standardGo`：函数级模式，不显示 table case 节点。

命令会写入 workspace 设置 `goBench.tableTests.testingApi.treeMode`。如果 Testing API 已启用，会立即刷新测试树。

该命令也贡献到 Testing 视图标题区；如果当前 VSCode 版本或布局没有显示按钮，可以从命令面板执行。

### `Go Bench: No-op`

用于验证插件是否成功激活。执行后会在 `Go Bench` output channel 写入日志，并显示一条信息提示。

## 设置

默认设置：

```json
{
  "goBench.tableTests.enabled": true,
  "goBench.tableTests.nameFields": ["name", "desc", "caseName", "title"],
  "goBench.tableTests.showFunctionRun": true,
  "goBench.tableTests.showCaseRun": true,
  "goBench.tableTests.testingApi.enabled": true,
  "goBench.tableTests.testingApi.treeMode": "goBench"
}
```

### `goBench.tableTests.enabled`

是否启用 Go table-driven test 识别能力。

- `true`：启用 parser、CodeLens 目标生成和 Test Explorer 目标生成。
- `false`：不显示 Go Bench 的测试运行入口；Testing API 树刷新时会清空 Go Bench 节点。

### `goBench.tableTests.nameFields`

用于识别 table case 名称的字段列表。

默认值：

```json
["name", "desc", "caseName", "title"]
```

示例：

```json
{
  "goBench.tableTests.nameFields": ["name", "scenario", "title"]
}
```

当 table entry 中包含这些字段且字段值是静态字符串时，Go Bench 会把它识别为 subtest/case 名称。

### `goBench.tableTests.showFunctionRun`

是否显示函数级运行和调试入口。

- `true`：在 `TestXxx` 上显示 `Run Test` / `Debug Test`，Test Explorer 中也会创建函数节点。
- `false`：隐藏函数级入口；当前实现不会创建该函数及其 case 节点。

### `goBench.tableTests.showCaseRun`

是否显示 case 级运行和调试入口。

- `true`：为可静态解析的 table case 显示 `Run Case` / `Debug Case`，并在 `goBench` 树模式下显示 case 节点。
- `false`：只保留函数级入口，不显示 table case 入口。

注意：`standardGo` 树模式即使该设置为 `true`，也不会在 Test Explorer 中展开 table case；CodeLens 是否显示 case 入口仍由该设置控制。

### `goBench.tableTests.testingApi.enabled`

是否启用 VSCode Testing API / Test Explorer 集成。

默认值：`true`。

- `true`：创建 `Go Bench` Test Explorer 树，运行结果进入 Test Results。
- `false`：释放 Go Bench Test Explorer controller；CodeLens 入口仍可使用。

### `goBench.tableTests.testingApi.treeMode`

Test Explorer 树模式。

可选值：

- `goBench`：默认值。显示 Go Bench 增强树，包括可识别 table case。
- `standardGo`：显示更接近官方 Go 插件的函数级树，不展开 table case。

示例：

```json
{
  "goBench.tableTests.testingApi.treeMode": "standardGo"
}
```

也可以用 `Go Bench: Toggle Test Tree Mode` 命令切换。

## 输出与结果

- Test Results：主要结果入口。CodeLens 和 Test Explorer 运行都会创建 Testing API `TestRun`。
- Test Explorer：显示运行中、通过、失败、跳过等状态。
- `Go Bench` output channel：辅助诊断入口，记录实际命令、parser diagnostic、go.mod 解析问题、debug configuration 和原始输出。

如果 `go test` 输出无法映射到具体子测试，Go Bench 会把输出写入当前 test run 的全局输出，避免结果丢失。

## 开发

安装依赖：

```sh
npm install
```

编译：

```sh
npm run compile
```

运行测试：

```sh
npm test
```

运行 lint：

```sh
npm run lint
```

在 VSCode 中使用 `Run Go Bench Extension` launch configuration 启动 Extension Development Host。

## 手动验证建议

1. 打开一个包含 `go.mod` 的 Go workspace。
2. 打开 `_test.go` 文件，确认函数和 table case 上出现 CodeLens。
3. 在 Test Explorer 中确认出现 `Go Bench` 树。
4. 确认树结构为 `module path -> relative directory -> file -> TestXxx -> case`。
5. 点击 `Run Test`、`Run Case`，在 Test Results 中查看输出。
6. 执行 `Go Bench: Toggle Test Tree Mode`，确认 case 节点可被隐藏或恢复。
7. 点击 `Debug Test` 或 `Debug Case`，确认 VSCode 启动 Go test debug session。

## 仓库

https://github.com/vuuvv/go-bench

## License

MIT
