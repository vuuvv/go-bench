# 里程碑 6 工作文档：项目级测试树刷新

## 完成功能范围

- 新增命令 `goPlus.refreshTestTree`，在命令面板显示为 `Go Plus: Refresh Test Tree`。
- 将命令注册到 `package.json` 的 activation events 和 contributes commands。
- 为实验 Testing API 原型增加 workspace 级扫描刷新能力。
- 将同一刷新能力接入 VSCode Test Explorer 的 refresh 按钮。
- 刷新时扫描 workspace 中所有 `_test.go` 文件，排除 `.git`、`node_modules` 和 `out`。
- 如果文件已经打开，刷新优先使用编辑器内未保存文本；否则读取磁盘文件。
- 刷新前清理旧测试树，避免删除或重命名文件后残留过期节点。
- Testing API 未启用时，刷新命令给出清晰提示，不创建异常状态。
- 补充 manifest 和常量测试，保护新命令不会从贡献声明中漂移。

## 核心文件和模块

- `src/constants.ts`：新增 `commands.refreshTestTree`。
- `package.json`：新增 `onCommand:goPlus.refreshTestTree` activation event 和命令贡献。
- `src/extension.ts`：注册 `Go Plus: Refresh Test Tree` 命令，并调用 Testing API manager 扫描 workspace。
- `src/testing.ts`：新增 `refreshWorkspace`、Test Explorer `refreshHandler`、全量清树和 workspace 文档读取逻辑。
- `test/constants.test.ts`：覆盖新命令 ID。
- `test/manifest.test.ts`：覆盖 activation event 和命令贡献。
- `docs/product-requirements.md`：新增里程碑 6。

## 实现思路与设计取舍

- 项目级刷新只服务实验 Testing API 树，不影响 CodeLens。CodeLens 仍按打开文档和编辑事件即时刷新。
- 命令始终可见，但只有 `goPlus.tableTests.testingApi.enabled` 为 `true` 时才真正扫描；关闭时提示用户开启实验树。
- Test Explorer refresh 按钮和命令面板命令复用同一个 `refreshWorkspace`，避免两套刷新行为不一致。
- 全量刷新先清空当前树再逐文件重建，逻辑简单，能准确处理文件删除、重命名和配置变化。
- 扫描使用 `vscode.workspace.findFiles('**/*_test.go', '**/{.git,node_modules,out}/**')`，避免把依赖、构建产物和 Git 元数据纳入树。
- 当前没有引入持久缓存或增量 diff。大项目性能仍需后续真实项目验证。

## 当前插件内可进行的操作

- 启用实验测试树：设置 `goPlus.tableTests.testingApi.enabled` 为 `true`。
- 通过命令面板刷新：执行 `Go Plus: Refresh Test Tree`，插件会扫描整个 workspace 的 `_test.go` 文件并重建 Go Plus 测试树。
- 通过 Test Explorer 刷新：在 Test Explorer 中点击 refresh，`Go Plus Table Tests` controller 会执行同样的全项目扫描。
- 查看刷新日志：`Go Plus` output channel 会显示扫描到的 Go 测试文件数量和实际刷新数量。
- 运行刷新后的节点：函数节点和 table case 子节点继续复用现有 `go test -run` runner。
- 点击定位：测试树节点仍携带 `uri` 和 `range`，点击 case 节点会定位到已识别 table entry。
- 未启用 Testing API 时刷新：命令会提示开启 `goPlus.tableTests.testingApi.enabled`，不会报错。

## 当前可进行操作

### 编译扩展

- 用途：验证新增命令、Testing API refresh handler 和 workspace 扫描逻辑类型正确。
- 命令：`npm run compile`
- 预期结果：`tsc -p ./` 通过。
- 失败优先检查：`TestController.refreshHandler` 回调类型、命令常量导入、VSCode workspace API 使用。

### 运行完整自动化测试

- 用途：验证 manifest、命令 ID、配置、parser、runner、CodeLens 和 Testing API 树模型。
- 命令：`npm test`
- 预期结果：当前通过 35 个断言。
- 失败优先检查：`package.json` activation events 和 contributes commands 是否与常量同步。

### 运行 lint

- 用途：验证新增异步刷新回调和公开 API 的 TypeScript 风格。
- 命令：`npm run lint`
- 预期结果：ESLint 无报错。
- 失败优先检查：异步回调是否声明返回类型、未使用变量、注释与实现是否同步。

### 手动刷新整个项目测试树

- 用途：确认未打开的 Go `_test.go` 文件也会进入 Go Plus 测试树。
- 入口：启用 `goPlus.tableTests.testingApi.enabled` 后，在命令面板执行 `Go Plus: Refresh Test Tree`。
- 预期结果：Test Explorer 中的 `Go Plus Table Tests` 被重新生成，`Go Plus` output channel 显示扫描和刷新数量。
- 失败优先检查：workspace 是否打开在 Go 项目根目录、Testing API 是否启用、文件是否以 `_test.go` 结尾、output channel 是否有 parser 诊断。

### 使用 Test Explorer 刷新按钮

- 用途：用 VSCode 原生测试刷新交互重建 Go Plus 测试树。
- 入口：启用实验树并打开 Test Explorer，点击刷新按钮。
- 预期结果：执行与命令面板相同的 workspace 扫描刷新。
- 失败优先检查：Test Explorer 中是否存在 `Go Plus Table Tests` controller、实验开关是否为 `true`。

## 测试记录

- 日期：2026-06-18
- 命令：`npm test`
  - 结果：通过，Node test 运行 35 个断言，全部通过。
- 命令：`npm run lint`
  - 结果：通过，ESLint 未报告问题。

## 已知问题和后续计划

- 当前项目级刷新还没有 Extension Host e2e 自动化测试；真实 Test Explorer UI 需要手动验证。
- 大型 workspace 中全量扫描可能较慢，后续可加入进度通知、取消提示或增量刷新。
- 当前扫描排除规则较保守，只排除 `.git`、`node_modules` 和 `out`；后续可考虑读取 `.gitignore` 或用户配置。
- Testing API 仍保持实验能力，默认关闭；CodeLens 仍是默认使用路径。
