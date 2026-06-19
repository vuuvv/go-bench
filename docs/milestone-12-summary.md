# 里程碑 12 工作总结：侧边栏框架

## 完成功能范围

- 新增 Go Bench Activity Bar 容器。
- 在 Go Bench 容器中注册 `Files`、`Tests`、`Run and Debug` 三个空 tree view。
- 新增侧边栏基础开关配置，用于控制侧边栏和三个视图是否展示。
- 新增 Files / Tests 视图标题区刷新命令。
- Tests 视图刷新命令会转发到现有 Test Explorer 刷新命令，保持当前测试树能力可复用。

## 核心文件和模块

- `package.json`：声明 Activity Bar view container、三个 view、标题区命令、激活事件和配置项。
- `src/constants.ts`：收口侧边栏命令、view ID 和默认配置。
- `src/sidebar.ts`：注册里程碑 12 的空视图 provider 和刷新命令。
- `src/extension.ts`：在扩展激活时挂载 Go Bench 侧边栏。
- `test/constants.test.ts`：保护命令、view ID、配置键和默认值。
- `test/manifest.test.ts`：保护 VSCode manifest 贡献契约。

## 实现思路与设计取舍

- 当前阶段只注册空 tree view，避免提前实现文件树、测试树映射或 runnable 模型。
- 侧边栏 view ID 在常量模块中集中维护，后续里程碑可以直接复用。
- `Tests` 视图刷新先复用现有 `goBench.refreshTestTree` 命令，确保迁移测试视图前不会分叉测试刷新逻辑。
- Activity Bar 图标暂时复用插件图标 `media/icon.png`。

## 已支持和不支持的模式

- 已支持：
  - Activity Bar 中显示 Go Bench 容器。
  - Go Bench 容器按顺序贡献 `Files`、`Tests`、`Run and Debug` 三个视图。
  - 三个视图可通过配置开关隐藏。
  - Files / Tests 视图具备标题区刷新命令。
- 暂不支持：
  - 文件树浏览和文件操作。
  - 侧边栏 Tests 视图展示测试节点。
  - runnable 列表、运行和调试。

## 测试记录

- 命令：`npm test`
- 结果：通过，53 个测试全部通过。
- 未覆盖风险：当前测试为 manifest 和常量契约测试，未启动真实 VSCode Extension Host 做手动视觉验证。

## 已知问题和后续计划

- 已知问题：三个视图当前为空，这是里程碑 12 的预期范围。
- 后续计划：里程碑 13 接入 Files 文件树；里程碑 14 接入 Tests 视图；里程碑 15 接入 Run and Debug runnable 列表。
- 待确认问题：Activity Bar 图标是否需要后续替换为专门适配 VSCode 侧边栏的单色 SVG。
