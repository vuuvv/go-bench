# 里程碑 14 工作总结：测试视图迁移

## 完成功能范围

- 将 Go Bench 侧边栏 `Tests` 视图从空 tree view 升级为真实测试树。
- 复用现有 parser、table case 配置和 `testingTargets` 树模型，展示 module、package、file、test function 和 table case 层级。
- Tests 视图各层节点按字母自然排序，减少扫描顺序导致的跳动。
- 支持 workspace 全量刷新，并在文件创建、删除、变更、workspace folders 变化和 table test 配置变化时同步刷新。
- 扫描 workspace 测试文件时，Tests 视图会显示 `Loading tests...` 转圈提示。
- 支持从 Tests 标题区按当前光标定位 `_test.go` 对应测试节点，优先定位到 table case，其次测试函数，最后文件节点。
- 支持打开测试函数或 table case 对应源码位置。
- 支持在 Tests 视图中对 module、package、file、测试函数和可解析 table case 执行 Run。
- 支持在 Tests 视图中对 module、package、file、测试函数和可解析 table case 执行 Debug。
- Run 入口复用同一个 Test Results reporter，继续写入 VSCode Test Results。
- 运行测试函数时，Test Results 会创建可解析 table case 子节点并显示子测试状态。
- 运行 module、package 或 file 时，Test Results 会在单次运行中保留 group/function/table case 树形层级。
- Test Results 中的函数和 table case 节点带源码范围，支持从结果面板定位回源码。
- Debug 入口复用 `goBench.debugTest`，继续使用现有 Go test debug configuration。
- Tests 视图运行后保持原有测试树视觉样式，运行状态统一在 Test Results 中展示。
- multi-root workspace 下 module 和 file 节点会显示所属 workspace 名称，帮助区分同名模块或文件。

## 核心文件和模块

- `src/sidebarTests.ts`：Tests 视图 TreeDataProvider、workspace 扫描、单文件刷新、文件监听和 Run/Debug 命令注册。
- `src/sidebar.ts`：把 Tests 视图接入真实 provider，并让标题区刷新同步触发现有 Test Explorer 刷新，Run 直接写入 Test Results。
- `src/testResults.ts`：支持 root test item 携带 table case 子节点，支持批量运行时的 group/function/case 树形 Test Results，并把 `go test -json` 事件映射到子测试状态。
- `src/constants.ts`：新增 Tests 视图 Run/Debug 命令 ID。
- `package.json`：新增 Tests 视图 Run/Debug 命令和右键菜单。
- `test/constants.test.ts`：覆盖新增命令 ID。
- `test/manifest.test.ts`：覆盖新增 manifest command 和 view/item/context 菜单贡献。

## 实现思路与设计取舍

- Tests 侧边栏不重新实现测试识别，直接复用 `createGoTestTreeNodes`，保证与现有 Test Explorer 原型和 CodeLens 使用同一套目标模型。
- Run/Debug 不另起执行链路，而是委托现有 `goBench.runTest` 和 `goBench.debugTest`，确保 runner、Test Results 和 debug 配置保持一致。
- Tests 视图负责触发运行和保持树结构稳定，详细输出和子测试状态由 Test Results 子节点展示。
- 刷新逻辑支持全量 workspace 扫描，也支持对已打开文档做单文件替换，减少编辑时 Tests 视图落后于未保存 buffer 的概率。
- Tests 侧边栏按 Go Bench 自身 table test 配置展示，不依赖 Test Explorer 当前是否切到 Go Bench tree mode；这样用户切回标准 Go Test Explorer 时，Go Bench 侧边栏仍可作为增强测试入口。

## 已支持和不支持的模式

- 已支持：
  - module/package/file/function/case 层级展示。
  - module、package 和 file 级批量运行和调试。
  - 函数级测试运行和调试。
  - 可解析 table case 运行和调试。
  - 标题区按当前光标定位 table case、测试函数或文件测试节点。
  - 函数运行后显示 table case 子测试状态。
  - Run 后在 Test Results 中显示最近一次运行状态。
  - 点击测试节点打开源码。
  - 标题区刷新按钮。
  - 文件和配置变化后的状态同步。
  - multi-root workspace 下显示 workspace 归属。
- 暂不支持：
  - 与 VSCode Test Explorer 展开状态或选择状态双向同步。
  - 对无法静态解析名称的动态 table case 生成单独节点。
  - 对大型 workspace 的增量文件索引；当前全量刷新仍依赖 `workspace.findFiles`。

## 测试记录

- 命令：`npm test`
- 结果：通过，61 个测试全部通过。
- 命令：`npm run lint`
- 结果：通过。
- 未覆盖风险：当前未启动真实 VSCode Extension Host 做手动视觉验证，Tests 视图交互主要依赖 TypeScript 编译、manifest 契约测试和既有 parser/tree/runner 单测保护。

## 手动验证步骤

- 打开包含 `go.mod` 和 `_test.go` 的 Go workspace。
- 打开 Go Bench Activity Bar，确认 `Tests` 视图展示 module/package/file/function/case 层级。
- 编辑一个已打开的 `_test.go` 文件，确认 Tests 视图刷新后节点与源码保持一致。
- 右键测试函数，执行 `Run Test`，确认 Test Results 中出现对应运行结果。
- 右键 table case，执行 `Run Test`，确认只运行对应 subtest。
- 右键测试函数或 table case，执行 `Debug Test`，确认启动 Go debug session。

## 已知问题和后续计划

- 已知问题：Tests 视图当前不在自身树节点上装饰运行结果，状态以 Test Results 为准。
- 后续计划：里程碑 15 接入 Run and Debug 视图，实现 runnable 数据模型、持久化和 run/debug/delete/edit。
