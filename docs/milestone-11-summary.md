# 里程碑 11 工作文档：Test Explorer 树形结构对齐 Go 插件

## 完成功能范围

- Test Explorer 不再把 `TestXxx` 函数直接作为根层级节点。
- Testing API 测试树改为 package/directory -> `_test.go` file -> `TestXxx` -> table case。
- 当前文件刷新会把文件节点合并到已有 package/directory 分组中。
- 当前文件没有可运行测试时，会移除文件节点，并裁剪空 package/directory 分组。
- 运行 package/directory 或文件结构节点时，会展开到其下可执行函数和 case 节点。

## 核心文件和模块

- `src/testingTargets.ts`：生成 package、file、function、case 四层纯数据树，并提供结构节点稳定 ID。
- `src/testing.ts`：合并结构节点、按文件替换子树、裁剪空分组，并让结构节点运行请求展开到可执行子节点。
- `test/testingTargets.test.ts`：覆盖 package/file 层级和可执行节点目标。
- `docs/product-requirements.md`：记录 Test Explorer 树结构要求。

## 实现思路与设计取舍

- 结构层仍保留在无 VSCode 依赖的 `testingTargets` 中，便于用单元测试保护树形数据。
- package/directory 标签在能确定 workspace root 时显示为 `./relative/path`，否则回退为绝对目录。
- package 和 file 节点不携带 `GoTestRunTarget`，避免把结构节点误当成单个测试。
- Test Explorer 运行结构节点时，适配层会收集后代 function/case 节点；函数节点作为集合运行目标，case 节点仍可单独运行。

## 已支持和不支持的模式

- 已支持：单文件刷新、workspace 全量刷新、package/file 结构分组、函数节点运行、case 节点运行、结构节点展开运行。
- 暂不支持：Extension Host 自动化断言真实 VSCode Test Explorer UI 层级。

## 当前可进行操作

### 编译扩展

- 用途：验证 Testing API 树结构和 VSCode 类型适配。
- 命令：`npm run compile`
- 预期结果：`tsc -p ./` 通过。

### 运行完整自动化测试

- 用途：验证 parser、runner、CodeLens、Testing API 树模型和 debug 配置构造。
- 命令：`npm test`
- 预期结果：当前通过 40 个断言，全部通过。

### 运行 lint

- 用途：验证新增结构树逻辑的代码风格。
- 命令：`npm run lint`
- 预期结果：ESLint 无报错。

### 手动验证 Test Explorer 树结构

- 用途：确认真实 VSCode UI 不再以 `TestXxx` 作为根层级。
- 入口：启用 `goBench.tableTests.testingApi.enabled`，执行 `Go Bench: Refresh Test Tree`。
- 预期结果：`Go Bench Table Tests` 下先显示 package/directory，再显示 `_test.go` 文件、`TestXxx` 和 table case。
- 失败优先检查：当前文件是否为 `_test.go`、Testing API 配置是否启用、output channel 中是否有 parser diagnostic。

## 测试记录

- 日期：2026-06-19
- 命令：`npm test`
  - 结果：通过，Node test 运行 40 个断言，全部通过。
- 命令：`npm run lint`
  - 结果：通过，ESLint 未报告问题。

## 已知问题和后续计划

- 当前仍缺少 Extension Host e2e 自动化测试，真实 Test Explorer UI 需要手动验证。
- CodeLens Test Results reporter 仍会在 Test Explorer 中显示独立的 `Go Bench CodeLens Runs` controller。
