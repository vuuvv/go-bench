# 里程碑 15 工作总结：运行与调试列表

## 实现范围

- Run and Debug 视图接入真实 runnable tree provider，不再显示空视图。
- 新增 workspace 级配置 `goBench.runnables.items`，用于持久化用户添加的 Go 文件和 Go package 运行目标。
- 新增 runnable 数据模型，支持稳定 ID、workspace 相对路径持久化、multi-root workspace 归属、`args`、`env`、`cwd`、创建和更新时间。
- 支持从当前编辑器文件、文件选择器、目录选择器、Go Bench Files 右键菜单添加 runnable。
- 支持重复添加提示更新已有目标，避免列表中出现同一文件或 package 的重复项。
- 支持 runnable 右键或 inline action 运行、调试、编辑、删除、打开目标和复制路径。
- Run and Debug 列表升级为树形结构，支持用户创建 group，并把 runnable 归档到 group 中。
- group 节点支持批量运行组内所有 runnable；删除 group 只移除分组，组内项目会回到根层级。
- 新增扫描按钮，可扫描 workspace 中所有静态 `package main` 且声明 `func main(...)` 的非测试 Go 文件，并通过多选列表批量加入。
- runnable 节点显示 package 名称，便于用户区分同名 `main.go`。
- runnable 默认名称改为 `module name + "/" + package path`，尾部 `/main` 会省略。
- runnable 节点的打开动作统一命名为 Open File，并作为每个项目的 inline action 展示。
- Open File 会定位到 `func main`，package 目录目标会在目录内寻找包含 main 函数的 Go 文件。
- 运行中的 runnable 支持 stop/restart；group 支持批量 stop/restart。
- runnable 节点新增 inline remove 按钮，用户不用打开右键菜单也能移除项目。
- Run and Debug 支持拖拽 runnable 到 group 归档，或拖到根层级移出 group。
- runnable 节点图标显示运行态：未运行显示目标类型，run 中显示彩色 play，debug 中显示彩色 debug。
- runnable inline 按钮按运行态切换：未运行只显示 Run/Debug，运行或调试中只显示 Restart/Stop。
- 普通 Go 文件中静态识别到 `package main` 和 `func main(...)` 时，会在 main 函数上显示 Run Main / Debug Main CodeLens。
- 运行使用 VSCode terminal，并写出 `go run` 命令；Go 文件执行 `go run <file>`，Go package 执行 `go run .`。
- 调试使用官方 Go debug adapter 兼容配置：`type: "go"`、`request: "launch"`、`mode: "debug"`。
- Go 文件添加时会检查 `package main`；非 `package main` 允许用户确认后继续添加。
- 删除 runnable 只移除 Go Bench 管理的列表项，不删除真实文件。

## 关键文件

- `src/runnablesModel.ts`：runnable 纯数据模型、持久化路径转换、去重、编辑、`go run` 命令和 debug 配置构造。
- `src/runnablesModel.ts`：补充分组、树形投影、package 解析和可执行 Go 文件识别。
- `src/runnables.ts`：Run and Debug tree provider、workspace settings 读写、扫描、分组、命令注册、terminal/debug 启动。
- `src/mainCodeLens.ts`：普通 Go 文件 main 函数 CodeLens provider。
- `src/mainCodeLensTargets.ts`：main 函数 CodeLens 目标生成和 range 定位。
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
- 在 Run and Debug 标题区点击 scan 图标，选择要加入的可执行 Go 文件。
- 在 Run and Debug 标题区创建 group。
- 在 Run and Debug runnable 节点右键选择归档到 group 或移回根层级。
- 在 Run and Debug group 节点上点击 run 图标，批量运行组内所有 runnable。
- 在 Run and Debug runnable 或 group 节点上点击 stop/restart 图标，停止或重启运行中的 terminal。
- 在 Run and Debug runnable 节点点击 inline remove 图标，移除列表项但不删除真实文件。
- 拖动 runnable 到 group 中完成归档；拖到列表根层级移出 group。
- 在普通 Go 文件的 `func main` 上点击 Run Main / Debug Main CodeLens。
- 在 Run and Debug runnable 节点右键执行编辑、删除、打开目标和复制路径。
- 运行目标会保存到 workspace settings，重启插件后仍可恢复。

## 验证命令

```sh
npm test
npm run lint
```

本次验证结果：

- `npm test`：通过，76 个测试全部成功。
- `npm run lint`：通过。

## 手动验证建议

- 打开包含 Go 项目的 workspace，确认 Go Bench 侧边栏中 Files、Tests、Run and Debug 均可见。
- 打开一个 `package main` 的 Go 文件，执行 `Go Bench: Add Current File to Run and Debug`，确认列表出现对应项。
- 对同一个文件再次添加，确认出现更新提示且列表不重复。
- 点击 runnable 的 run 图标，确认 VSCode terminal 中执行 `go run <file>` 或 `go run .`。
- 点击 runnable 的 debug 图标，确认启动 Go debug session。
- 删除 runnable，确认列表项移除且真实文件仍保留。
- 重载 Extension Development Host，确认 runnable 列表仍存在。
- 创建 group，将一个 runnable 归档进去，确认树形结构可展开且 group run 会依次启动组内项目。
- 点击 scan 按钮，确认只出现 `package main` 且声明 `func main(...)` 的非 `_test.go` Go 文件，并能批量加入列表。
- 点击 Open File，确认编辑器跳转到 `func main` 所在位置。
- 运行项目后点击 Stop，确认对应 terminal 被关闭；点击 Restart，确认 terminal 关闭后重新运行。
- 运行或调试项目后确认节点图标变色，按钮从 Run/Debug 切换为 Restart/Stop。
- 将 runnable 拖入 group，再拖回根层级，确认归档状态正确持久化。
- 打开包含 `package main` 和 `func main` 的普通 Go 文件，确认 main 函数上显示 Run Main / Debug Main CodeLens。

## 已知边界

- 第一阶段只支持 Go 文件和 Go package 目录，不支持任意 shell command。
- `args` 使用空白分隔的 quick input 解析，暂不支持复杂 shell quoting。
- `env` 通过 quick input 输入 `KEY=value` 文本；复杂配置可直接编辑 workspace settings。
- package 目录添加不自动扫描是否包含 `package main`，运行失败时保留 terminal 输出。
- workspace folder 通过名称恢复；如果 multi-root workspace 中存在同名根目录，后续需要扩展为更强的 workspace 标识。
- 扫描只做静态 package 声明识别，不解析 build tags、`go:generate` 或间接入口。
