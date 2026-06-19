# 里程碑 15 工作总结：运行与调试列表

## 实现范围

- Run and Debug 视图接入真实 runnable tree provider，不再显示空视图。
- 新增 workspace 级配置 `goBench.runnables.items`，用于持久化用户添加的 Go 文件和 Go package 运行目标。
- 新增 runnable 数据模型，支持稳定 ID、workspace 相对路径持久化、multi-root workspace 归属、`args`、`env`、`cwd`、创建和更新时间。
- 支持从当前编辑器文件、文件选择器、目录选择器、Go Bench Files 右键菜单添加 runnable。
- 支持重复添加提示更新已有目标，避免列表中出现同一文件或 package 的重复项。
- 支持 runnable 右键或 inline action 运行、调试、编辑、删除、打开目标和复制路径。
- 运行使用 VSCode terminal，并写出 `go run` 命令；Go 文件执行 `go run <file>`，Go package 执行 `go run .`。
- 调试使用官方 Go debug adapter 兼容配置：`type: "go"`、`request: "launch"`、`mode: "debug"`。
- Go 文件添加时会检查 `package main`；非 `package main` 允许用户确认后继续添加。
- 删除 runnable 只移除 Go Bench 管理的列表项，不删除真实文件。

## 关键文件

- `src/runnablesModel.ts`：runnable 纯数据模型、持久化路径转换、去重、编辑、`go run` 命令和 debug 配置构造。
- `src/runnables.ts`：Run and Debug tree provider、workspace settings 读写、命令注册、terminal/debug 启动。
- `src/sidebar.ts`：将 Run and Debug 视图接入 `GoBenchRunnablesProvider`。
- `src/constants.ts`：新增 runnable 命令和配置键。
- `package.json`：贡献 Run and Debug 标题区操作、runnable 节点菜单、Files 视图添加入口和配置项。
- `test/runnablesModel.test.ts`：覆盖 runnable 添加、重复更新、删除、编辑、持久化恢复、命令构造和 debug 配置。
- `test/manifest.test.ts`：保护新增命令、菜单和配置贡献契约。

## 当前可进行操作

- 在 Go Bench Activity Bar 打开 `Run and Debug` 视图。
- 点击 Run and Debug 标题区的 `+` 添加当前 Go 文件。
- 点击 Run and Debug 标题区的文件按钮，通过文件选择器添加 Go 文件。
- 点击 Run and Debug 标题区的 package 按钮，通过目录选择器添加 Go package。
- 在 Go Bench `Files` 视图中右键 Go 文件，选择添加到 Run and Debug。
- 在 Go Bench `Files` 视图中右键目录或 workspace 根，选择添加为 Go package 运行目标。
- 在 Run and Debug runnable 节点上点击 inline run/debug 图标。
- 在 Run and Debug runnable 节点右键执行编辑、删除、打开目标和复制路径。
- 运行目标会保存到 workspace settings，重启插件后仍可恢复。

## 验证命令

```sh
npm test
npm run lint
```

本次验证结果：

- `npm test`：通过，68 个测试全部成功。
- `npm run lint`：通过。

## 手动验证建议

- 打开包含 Go 项目的 workspace，确认 Go Bench 侧边栏中 Files、Tests、Run and Debug 均可见。
- 打开一个 `package main` 的 Go 文件，执行 `Go Bench: Add Current File to Run and Debug`，确认列表出现对应项。
- 对同一个文件再次添加，确认出现更新提示且列表不重复。
- 点击 runnable 的 run 图标，确认 VSCode terminal 中执行 `go run <file>` 或 `go run .`。
- 点击 runnable 的 debug 图标，确认启动 Go debug session。
- 删除 runnable，确认列表项移除且真实文件仍保留。
- 重载 Extension Development Host，确认 runnable 列表仍存在。

## 已知边界

- 第一阶段只支持 Go 文件和 Go package 目录，不支持任意 shell command。
- `args` 使用空白分隔的 quick input 解析，暂不支持复杂 shell quoting。
- `env` 通过 quick input 输入 `KEY=value` 文本；复杂配置可直接编辑 workspace settings。
- package 目录添加不自动扫描是否包含 `package main`，运行失败时保留 terminal 输出。
- workspace folder 通过名称恢复；如果 multi-root workspace 中存在同名根目录，后续需要扩展为更强的 workspace 标识。
