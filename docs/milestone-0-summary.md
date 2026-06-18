# 里程碑 0 工作文档：项目骨架

## 完成功能范围

- 初始化 VSCode extension 项目骨架。
- 添加 TypeScript build、ESLint lint 和 Node test 配置。
- 注册 Go 语言、工作区 Go 测试文件和 no-op command 相关 activation events。
- 新增 `Go Plus` output channel。
- 注册 `goPlus.noop` 命令，用于验证扩展激活与命令注册。
- 建立代码注释规范和工作文档模板。

## 核心文件和模块

- `package.json`：声明扩展入口、activation events、命令、配置项和开发脚本。
- `src/extension.ts`：VSCode 扩展激活入口，负责 output channel 和 no-op command 生命周期。
- `src/constants.ts`：集中维护命令 ID、output channel 名称和 table test 默认配置。
- `test/constants.test.ts`：保护里程碑 0 的稳定常量契约。
- `eslint.config.mjs`：配置 TypeScript lint 规则，要求导出函数显式返回类型。
- `.vscode/launch.json`、`.vscode/tasks.json`：支持 Extension Development Host 启动和常用任务。
- `docs/comment-guidelines.md`：代码注释规范。
- `docs/work-document-template.md`：后续里程碑和重要功能的工作文档模板。

## 关键实现思路与设计取舍

- 当前阶段只实现 no-op command，不提前引入 parser、CodeLens 或 runner，避免骨架阶段承担未验证行为。
- output channel 在激活时创建并由 `context.subscriptions` 托管，后续 runner 可以复用同一频道展示 `go test` 输出。
- 配置项先按 PRD 第一阶段默认值写入 manifest，并在代码侧集中定义默认配置，便于后续配置读取逻辑和测试复用。
- 测试使用 Node 内置 `node:test`，减少测试框架复杂度；VSCode Extension Host 集成测试留到 CodeLens 与 runner 阶段补充。

## 已支持和不支持的模式

- 已支持：扩展可被 Go 语言文件、工作区 `_test.go` 文件或 `goPlus.noop` 命令激活。
- 已支持：执行 no-op command 时向 `Go Plus` output channel 写入日志，并显示轻量提示。
- 暂不支持：Go parser、table-driven test 检测、CodeLens、`go test` runner 和 VSCode Testing API。

## 测试记录

- 命令：`npm install`
  - 结果：通过，安装 111 个依赖包，`npm audit` 报告 0 个漏洞。
- 命令：`npm run compile`
  - 结果：通过，TypeScript 编译成功。
- 命令：`npm run lint`
  - 结果：通过，ESLint 未报告问题。
- 命令：`npm test`
  - 结果：通过，Node test 运行 7 个断言，全部通过。

未覆盖风险：当前自动化测试只覆盖骨架常量和基础配置，尚未启动真实 VSCode Extension Development Host。no-op command 已在 manifest 和 `src/extension.ts` 中注册，可通过 `.vscode/launch.json` 启动 Extension Development Host 后执行 `Go Plus: No-op` 手动验证。

## 已知问题和后续计划

- 已知问题：尚未实现任何 Go AST 解析能力。
- 后续计划：里程碑 1 评估 parser 方案，并产出测试函数元数据与 VSCode range 映射。
- 待确认问题：是否在后续阶段优先采用 Go helper binary，还是先验证 TypeScript parser 可维护性。
