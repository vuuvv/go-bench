# Go Bench 侧边栏产品需求文档

## 1. 产品概述

Go Bench 需要新增一个独立的 VSCode 侧边栏工作台，将项目文件、Go 测试和可运行文件管理收敛到同一个插件入口中。

新侧边栏应尽量贴近 VSCode 原生资源管理器的使用体验：左侧 Activity Bar 中提供 Go Bench 入口，打开后在侧边栏中展示三个核心功能视图：

- 文件：提供与 VSCode 原生资源管理器一致或高度接近的文件浏览与管理体验。
- 测试：承接当前项目已经实现的 Test Explorer 能力，展示 Go module、package、测试文件、测试函数和 table case。
- 运行与调试：提供可管理的可运行文件列表，用户可以添加、删除、运行或调试列表项。

该侧边栏的核心定位不是替代 VSCode，而是为 Go 项目提供一个更聚焦的工作台，让开发者在同一处完成“找文件、跑测试、运行程序、进入调试”的高频动作。

重要边界：文件、测试、运行与调试这三个功能视图必须位于 Go Bench 自己贡献的 Activity Bar 容器中。插件不得把这些视图挂载到 VSCode 原有资源管理器 Explorer 侧边栏中，也不得要求用户从原有 Explorer 入口进入这些 Go Bench 功能。

## 2. 背景

当前 Go Bench 已经具备 Go table-driven tests 的识别、CodeLens 运行入口、VSCode Testing API 测试树、Test Results 输出和 Go test debug 能力。

这些能力分散在编辑器 CodeLens、VSCode Test Explorer、命令面板和 Output/Test Results 视图中。对于用户来说，测试能力已经有了，但入口不够集中；运行普通 Go 文件或项目内可执行入口时，还需要手动打开文件、输入命令或维护 launch 配置。

新的侧边栏希望把这些能力组织成一个清晰、稳定、可扩展的 Go Bench 工作区。

## 3. 产品目标

- 在 Activity Bar 中新增 Go Bench 侧边栏入口。
- 侧边栏内提供文件、测试、运行与调试三个功能视图。
- 文件、测试、运行与调试三个视图必须只贡献到 Go Bench 自己的 Activity Bar 容器，不侵入 VSCode 原有 Explorer 资源管理器侧边栏。
- 文件视图尽量保持与 VSCode 原生 Explorer 一致的视觉、交互和行为。
- 测试视图复用现有 Go Bench Test Explorer 的识别、运行、调试和结果展示能力。
- 运行与调试视图支持用户维护可运行文件列表，并可直接执行 run/debug。
- 保持对官方 Go 插件和 VSCode 原生命令的复用，不重新实现 Go 工具链。
- 为后续 coverage、任务模板、launch 配置同步和项目级运行目标留下扩展点。

## 4. 当前阶段非目标

- 不替代 VSCode 原生 Explorer、Search、Source Control、Run and Debug 等内置工作台。
- 不实现完整 IDE 级项目系统。
- 不自动推断所有可执行入口并强制加入列表。
- 不修改用户源码。
- 不要求第一阶段支持复杂 task 编排、容器运行、远程调试或多进程调试。
- 不把测试运行器改造成自定义 Go 测试框架，仍复用标准 `go test`、官方 Go 插件和 VSCode Testing API。

## 5. 目标用户

- 使用 VSCode 开发 Go 项目的后端工程师。
- 经常在文件、测试、运行、调试之间切换的开发者。
- 维护大量 Go table-driven tests，希望在插件侧边栏中集中查看和运行测试的团队。
- 希望把常用 `main.go`、命令入口或脚本入口固定到可运行列表中的开发者。

## 6. 核心用户故事

- 作为 Go 开发者，我希望在 Go Bench 侧边栏中看到项目文件树，这样可以不用离开插件工作台就能打开或管理文件。
- 作为 Go 开发者，我希望在同一个侧边栏中查看当前项目的测试树，这样可以快速运行或调试测试函数和 table case。
- 作为 Go 开发者，我希望把常用可运行文件加入列表，这样可以一键运行或调试，而不是反复输入命令。
- 作为 Go 开发者，我希望可以删除、重命名或调整可运行列表项，这样列表能保持干净。
- 作为 Go 开发者，我希望运行或调试失败时能看到清晰错误和原始输出，方便快速定位环境或命令问题。

## 7. 信息架构

### 7.1 Activity Bar 入口

插件应贡献一个新的 VSCode Activity Bar 容器：

- 展示名称：`Go Bench`
- 推荐图标：复用插件图标或使用简化的 workbench/test 风格图标。
- 容器内默认包含三个 view：
  - `Files`
  - `Tests`
  - `Run and Debug`

视图顺序必须固定为：

1. 文件
2. 测试
3. 运行与调试

### 7.2 独立侧边栏边界

Go Bench 侧边栏必须是一个新的 Activity Bar 入口，而不是 VSCode 原有 Explorer 资源管理器侧边栏中的子视图。

必须满足：

- `Files`、`Tests`、`Run and Debug` 三个 view 只挂载在 Go Bench 自己的 view container 下。
- 不向 VSCode 原有 `Explorer` / `资源管理器` 容器贡献这三个 view。
- 不在原有 Explorer 的标题区或文件节点右键菜单中加入这三个功能的主入口。
- 用户点击 Activity Bar 中的 `Go Bench` 图标后，才进入 Go Bench 自己的侧边栏工作台。
- Go Bench 的文件视图可以复用 VSCode 原生命令和文件系统 API，但不能依赖原有 Explorer 作为承载容器。

验收时应通过 manifest 契约检查确认：Go Bench 的三个 view 只出现在 `go-bench-sidebar` 容器下，不能出现在 `explorer` 或其他 VSCode 内置容器下。Activity Bar 容器 ID 必须遵守 VSCode manifest 限制，只使用字母、数字、`_` 和 `-`，不能包含点号。

### 7.3 视图折叠行为

- 三个视图应支持 VSCode 标准的展开、折叠和标题区操作。
- 默认展开策略：
  - 文件：展开。
  - 测试：展开。
  - 运行与调试：展开。
- 用户手动折叠状态应由 VSCode 保持。

## 8. 功能需求

### 8.1 文件视图

文件视图目标是提供与 VSCode 原生资源管理器一致的文件管理体验。产品要求是：在用户可感知层面，文件树图标、节点操作、右键菜单结构和核心文件行为都应尽量与 VSCode 原生 Explorer 保持一致。

实现边界：VSCode 扩展 API 不支持把原生 Explorer 直接嵌入自定义 Activity Bar 容器，也不支持自动继承 VSCode 内部和其他扩展贡献到 `explorer/context` 的全部菜单项。因此 Go Bench Files 必须在自己的 view 中复刻 Explorer 的核心行为，并复用 VSCode 资源图标、文件系统 API、内置命令和主题能力；不能因为 API 限制而退回到把功能挂进原有 Explorer。

第一阶段必须支持：

- 展示当前 workspace 根目录下的文件树内容。
- 默认不显示项目根目录本身，Files 视图顶层直接展示项目根目录下的子文件和子目录。
- 支持 multi-root workspace，并保留每个节点所属 workspace 信息；顶层直接展示各 workspace 根目录下的子文件和子目录。
- 文件和目录使用 VSCode 当前主题对应的 file icon / folder icon。
- 点击文件时在编辑器中打开该文件。
- 点击目录时展开或折叠目录。
- 支持刷新文件树。
- 支持新建文件。
- 支持新建文件夹。
- 支持打开到旁边。
- 支持 Open With。
- 支持剪切、复制、粘贴文件或文件夹。
- 支持重命名文件或文件夹。
- 支持删除文件或文件夹，并遵循 VSCode 的删除确认行为。
- 支持在文件夹中搜索。
- 支持在系统文件管理器中 reveal 文件或目录。
- 支持复制相对路径和绝对路径。
- 文件变化时自动刷新，包括新增、删除、重命名和保存。

文件视图应尽量复用 VSCode 原生命令和行为：

- 打开文件使用 VSCode 文本编辑器 API。
- 新建、重命名、删除等文件操作优先调用 VSCode workspace/fs API 或内置命令。
- 如果 VSCode 扩展 API 不允许直接嵌入原生 Explorer，则实现一个体验等价的文件树，而不是强依赖不可用能力。

第一阶段可选支持：

- 文件过滤输入框。
- 按 `.gitignore` 隐藏文件。
- 拖拽移动文件。
- 对当前编辑器文件执行 reveal in Go Bench Files。
- 和 VSCode 原生 Explorer 保持展开状态同步。

明确不支持：

- 第一阶段不实现 Git 状态装饰的完整复刻。
- 第一阶段不实现复杂搜索和替换。
- 由于 VSCode 不提供自动继承 `explorer/context` 的 API，第一阶段不保证第三方扩展贡献到原生 Explorer 的菜单也同步出现在 Go Bench Files 中。

### 8.2 测试视图

测试视图应承接当前项目中已经实现的 Go Bench Test Explorer 能力，并迁移或同步到 Go Bench 侧边栏内。

测试树结构应继续保持：

```text
Go Bench
└── module path
    └── package / relative directory
        └── _test.go file
            └── TestXxx
                ├── table case
                └── table case
```

第一阶段必须支持：

- 展示 Go module、package/directory、测试文件、测试函数和可解析 table case。
- 支持 workspace 全量刷新。
- 支持当前文件刷新。
- 支持从测试函数节点运行整个测试函数。
- 支持从 table case 节点运行单个 case。
- 支持从测试函数节点调试整个测试函数。
- 支持从 table case 节点调试单个 case。
- 支持测试运行状态展示，包括 running、passed、failed、skipped 和 errored。
- 支持失败信息和原始输出进入 VSCode Test Results。
- 支持与现有 `goBench.tableTests.testingApi.treeMode` 行为兼容。

测试视图应复用现有能力：

- 复用 parser 识别 Go table-driven tests。
- 复用 runner 构造 `go test -run`。
- 复用 debug 配置构造。
- 复用 Testing API 或同源测试树模型，避免侧边栏测试树和 Test Explorer 测试树出现不同结果。

第一阶段可选支持：

- 在侧边栏测试节点标题区显示 run/debug inline icon。
- 提供 collapse all。
- 提供仅显示失败测试的过滤模式。
- 支持从失败结果跳转到源码位置。

明确不支持：

- 不重新设计一套与 VSCode Testing API 无关的测试状态系统。
- 不支持动态生成且无法静态解析的 table case。
- 不支持第一阶段 coverage profile。

### 8.3 运行与调试视图

运行与调试视图用于管理用户主动添加的可运行文件或运行目标。

#### 8.3.1 列表项模型

每个列表项至少包含：

- `id`：稳定唯一 ID。
- `label`：展示名称，默认使用文件名或目录名。
- `uri`：目标文件或目录路径。
- `workspaceFolder`：所属 workspace。
- `kind`：目标类型，例如 `goFile`、`goPackage`、`customCommand`。
- `cwd`：运行工作目录。
- `args`：运行参数。
- `env`：可选环境变量。
- `createdAt` / `updatedAt`：用于后续排序和维护。
- `packageName`：Go package 名称，用于在列表中显示目标所属 package。
- `groupId`：可选分组 ID，用于把运行目标归档到用户创建的组中。

运行与调试视图必须以树形结构展示：

- 根层级展示用户创建的 group 和未分组 runnable。
- group 节点展开后展示组内 runnable。
- runnable 节点名称默认使用 `module name + "/" + package path`，如果最终段为 `main` 可以省略该段。
- runnable 节点必须显示目标 package，例如 `package main`，作为名称之外的辅助信息。
- runnable 节点前的图标必须展示当前运行状态，并区分 run 和 debug。
- 既有未分组项目必须保持可见，不能因为引入 group 而丢失。

第一阶段推荐优先支持：

- Go 文件：例如 `main.go`，运行时使用 `go run <file>`。
- Go package 目录：运行时使用 `go run .`。

后续可扩展：

- 自定义命令。
- npm script、Makefile target、task、launch configuration。
- 最近运行记录。

#### 8.3.2 添加列表项

必须提供以下添加方式：

- 从当前打开文件添加。
- 从文件选择器添加。
- 从目录选择器添加 package 入口。
- 从文件视图右键菜单添加。
- 从 Run and Debug 视图标题区点击 scan 图标，扫描 workspace 中所有可执行 Go 文件。

扫描添加行为：

- scan 只识别静态 `package main` 且声明 `func main(...)` 的非 `_test.go` Go 文件。
- 扫描完成后通过多选列表让用户选择要加入 Run and Debug 的文件。
- 列表项应显示文件名、相对路径和 package 名称。
- 已存在的扫描结果应默认不重复添加；用户重新选择时更新已有项。

添加时行为：

- 如果目标已经存在，应提示用户是否更新已有列表项，而不是重复添加。
- 默认 label 使用文件名；用户可以编辑 label。
- 默认 cwd 使用文件所在目录或 package 目录。
- 对 Go 文件应检查是否是可运行入口；如果不是 `package main`，允许添加但需要提示运行可能失败。

#### 8.3.3 删除列表项

必须支持：

- 从列表项 inline action 删除。
- 从右键菜单删除。
- 删除前提示确认。
- 删除只影响 Go Bench 管理的列表，不删除真实文件。

#### 8.3.3.1 分组管理

必须支持：

- 创建 runnable group。
- 将单个 runnable 归档到已有 group。
- 将单个 runnable 从 group 移回根层级。
- 支持拖拽 runnable 到 group 中完成归档。
- 支持拖拽 runnable 到列表根层级完成移出 group。
- 删除 group 时只删除分组，不删除真实文件，也不删除组内 runnable；组内 runnable 回到根层级。
- group 节点提供批量运行入口，点击后依次运行组内所有 runnable。

#### 8.3.4 编辑列表项

必须支持：

- 修改展示名称。
- 修改运行参数。
- 修改工作目录。
- 修改环境变量。

第一阶段可先通过 quick input / settings JSON 完成编辑，不要求复杂表单 UI。

#### 8.3.5 运行列表项

每个列表项必须提供 run 按钮。

每个 group 必须提供 run 按钮，用于批量运行组内所有 runnable。

Go 文件运行行为：

```sh
go run <file>
```

Go package 运行行为：

```sh
go run .
```

运行要求：

- 在 VSCode terminal 中执行，方便用户交互输入。
- terminal 名称应包含 `Go Bench` 和列表项 label。
- 运行前清晰展示实际执行命令。
- 支持传入用户配置的 args 和 env。
- 命令失败时保留 terminal 输出。
- 对正在运行的 runnable 必须支持停止当前 terminal。
- 对正在运行的 runnable 必须支持重启；重启行为为先停止当前 terminal，再重新执行 run。
- group 必须支持批量停止和批量重启组内 runnable。
- 未运行的 runnable 只显示 run/debug inline 按钮，不显示 restart/stop。
- 正在 run 或 debug 的 runnable 只显示 restart/stop inline 按钮，不显示 run/debug。
- group 仅在组内存在运行或调试中的项目时显示批量 stop/restart。

#### 8.3.6 调试列表项

每个列表项必须提供 debug 按钮。

调试要求：

- 优先复用官方 Go 插件 debug adapter。
- Go 文件调试配置使用 `type: "go"`、`request: "launch"`、`mode: "debug"`。
- Go package 调试配置的 `program` 指向 package 目录。
- 支持传入 args、env 和 cwd。
- 调试启动失败时显示错误，并写入 `Go Bench` output channel。

#### 8.3.7 列表持久化

第一阶段列表应持久化到 workspace 级配置或插件管理文件中。

推荐方案：

- 默认使用 workspace scope 的 VSCode configuration，便于随 workspace 保存。
- 后续如列表结构变复杂，可迁移到 `.vscode/go-bench-runnables.json`。

持久化要求：

- 不因为插件重启丢失列表。
- 不把用户本地绝对路径错误写入跨机器共享配置，除非该路径确实在 workspace 外部。
- multi-root workspace 中必须保存所属 workspace 信息。

## 9. 命令与配置

### 9.1 命令

建议新增命令：

```json
{
  "goBench.sidebar.refreshFiles": "Go Bench: Refresh Files",
  "goBench.sidebar.refreshTests": "Go Bench: Refresh Tests",
  "goBench.runnables.addCurrentFile": "Go Bench: Add Current File to Run and Debug",
  "goBench.runnables.addFile": "Go Bench: Add File to Run and Debug",
  "goBench.runnables.addPackage": "Go Bench: Add Package to Run and Debug",
  "goBench.runnables.scanFiles": "Go Bench: Scan Executable Go Files",
  "goBench.runnables.createGroup": "Go Bench: Create Runnable Group",
  "goBench.runnables.moveToGroup": "Go Bench: Archive Runnable to Group",
  "goBench.runnables.runGroup": "Go Bench: Run Runnable Group",
  "goBench.runnables.stopGroup": "Go Bench: Stop Runnable Group",
  "goBench.runnables.restartGroup": "Go Bench: Restart Runnable Group",
  "goBench.runnables.removeGroup": "Go Bench: Remove Runnable Group",
  "goBench.runnables.remove": "Go Bench: Remove Runnable",
  "goBench.runnables.edit": "Go Bench: Edit Runnable",
  "goBench.runnables.run": "Go Bench: Run Runnable",
  "goBench.runnables.stop": "Go Bench: Stop Runnable",
  "goBench.runnables.restart": "Go Bench: Restart Runnable",
  "goBench.runnables.debug": "Go Bench: Debug Runnable",
  "goBench.runnables.reveal": "Go Bench: Open Runnable File"
}
```

现有命令应继续可用：

- `goBench.runTest`
- `goBench.debugTest`
- `goBench.refreshTestTree`
- `goBench.refreshCurrentFileTestTree`
- `goBench.toggleTestTreeMode`

### 9.2 配置

建议新增配置：

```json
{
  "goBench.sidebar.enabled": true,
  "goBench.sidebar.files.enabled": true,
  "goBench.sidebar.tests.enabled": true,
  "goBench.sidebar.runnables.enabled": true,
  "goBench.runnables.items": [],
  "goBench.runnables.groups": [],
  "goBench.runnables.defaultRunInTerminal": true
}
```

后续可扩展配置：

```json
{
  "goBench.sidebar.files.exclude": [],
  "goBench.sidebar.files.respectGitignore": true,
  "goBench.runnables.defaultEnv": {},
  "goBench.runnables.terminalReuseMode": "perItem",
  "goBench.runnables.autoDetectMainPackages": false
}
```

## 10. 产品行为细节

### 10.1 空状态

文件视图空状态：

- 没有打开 workspace 时显示提示：打开一个 workspace 后查看文件。

测试视图空状态：

- 没有发现 Go 测试文件时显示提示：未发现 `_test.go` 文件。
- 找不到有效 `go.mod` 时显示提示，并在 output channel 写入诊断。

运行与调试空状态：

- 没有列表项时显示添加入口。
- 推荐首要操作：添加当前文件。

### 10.2 节点操作

文件节点：

- 文件：打开、重命名、删除、复制路径、在系统文件管理器中显示、添加到运行与调试。
- 目录：展开、折叠、新建文件、新建文件夹、重命名、删除、添加为 Go package 运行目标。

测试节点：

- module/package/file：刷新、运行集合。
- 测试函数：运行、调试、打开源码。
- table case：运行、调试、打开源码。

运行与调试节点：

- 打开文件。
- 运行。
- 停止。
- 重启。
- 调试。
- 编辑。
- 归档到 group。
- 删除，且必须提供可见的 inline remove 按钮。
- 复制路径。

运行与调试 group 节点：

- 展开/折叠。
- 批量运行组内所有项目。
- 批量停止组内所有运行中项目。
- 批量重启组内项目。
- 删除 group，并保留组内项目。

### 10.3 图标和按钮

- run 使用 VSCode codicon `play`。
- debug 使用 `debug-alt` 或 VSCode 推荐 debug codicon。
- running 状态图标使用带颜色的 `play-circle`。
- debugging 状态图标使用带颜色的 `debug-alt`。
- refresh 使用 `refresh`。
- add 使用 `add`。
- scan 使用 `search`。
- stop 使用 `debug-stop`。
- restart 使用 `debug-restart`。
- remove 使用 `trash`。
- edit 使用 `edit`。
- reveal 使用 `go-to-file` 或 `folder-opened`。

按钮必须提供 hover title，避免只有图标造成误解。

### 10.4 错误处理

- 文件操作失败时展示 VSCode error message，并保留详细错误到 output channel。
- 测试解析失败时不打扰用户，除非用户主动刷新或运行。
- 运行目标缺失时，提示用户从列表中移除或重新定位。
- Go 工具链不可用时，运行和调试都应提示检查 Go 安装和 PATH。
- Debug adapter 缺失时，提示安装或启用官方 Go 插件。

### 10.5 main 函数 CodeLens

普通 Go 文件中如果静态识别到 `package main` 且包含 `func main(...)`，必须在 main 函数声明上方显示：

- `Run Main`：复用 Run and Debug runnable 运行逻辑。
- `Debug Main`：复用 Run and Debug runnable 调试逻辑。

CodeLens 行为要求：

- 不在 `_test.go` 文件中显示 main CodeLens。
- CodeLens 目标名称使用 Run and Debug 的默认命名规则。
- CodeLens 触发的运行目标应与 Run and Debug terminal 管理一致。

## 11. 技术要求

### 11.1 架构建议

推荐新增模块：

- `sidebar`：注册 Go Bench view container 和三个 view。
- `fileExplorer`：文件树数据提供、文件操作、文件系统监听。
- `testSidebar`：复用 Testing API 树模型，映射为侧边栏测试视图。
- `runnables`：可运行列表的数据模型、持久化、添加、编辑和删除。
- `runnableRunner`：构造并执行 `go run` terminal 命令。
- `runnableDebugger`：构造 Go debug configuration。

已有模块应继续复用：

- `parser`
- `runner`
- `debugger`
- `testingTargets`
- `testing`
- `goModule`
- `testResults`

### 11.2 数据一致性

- 测试视图不能重新实现一套独立 parser。
- CodeLens、Test Explorer 和新侧边栏测试视图必须使用同源测试目标数据。
- 运行与调试列表项中的路径应在 workspace folder 重命名或移动后尽量保持可恢复。
- 文件系统 watcher 应做 debounce，避免大量文件变化导致侧边栏频繁刷新。

### 11.3 性能要求

- 文件视图应懒加载目录节点，避免打开大型仓库时阻塞 extension host。
- 测试刷新应复用已有 workspace 扫描策略。
- 普通目录展开应在 100ms 内返回可见节点，超大目录可延迟加载。
- 所有长耗时操作必须异步执行。

### 11.4 测试覆盖要求

必须补充自动化测试覆盖：

- Activity Bar/view contribution 的 manifest 契约。
- Go Bench 三个 view 只贡献到独立 `go-bench-sidebar` 容器，不能贡献到 VSCode 原有 Explorer 容器。
- 文件树节点构造。
- multi-root workspace 下顶层文件节点的所属 workspace 信息。
- 文件 exclude 配置。
- 测试树数据复用和节点映射。
- runnable 添加、重复添加、删除和编辑。
- runnable 持久化和恢复。
- `go run <file>` 命令构造。
- `go run .` 命令构造。
- runnable debug configuration 构造。
- 缺失文件、非 Go 文件、非 `package main` 的提示行为。

手动验证必须覆盖：

- 新侧边栏入口在 Activity Bar 中可见。
- 文件视图可以打开、新建、重命名和删除文件。
- 测试视图可以运行和调试测试函数及 table case。
- 运行与调试视图可以添加当前文件、运行、调试和删除列表项。

### 11.5 Git 提交要求

每次任务完成后，必须生成标准、清晰、带类型和 scope 前缀的 git commit 信息并提交代码，确保实现、测试、文档和需求变更可以被追踪。

提交要求：

- 提交前必须检查 `git status`，确认本次提交只包含当前任务相关变更。
- 提交前必须执行与本次变更匹配的验证命令，并在回复或工作文档中记录结果。
- commit message 必须使用 `type(scope): summary` 格式，例如 `docs(product-requirements): 补充里程碑可操作清单要求`。
- `type` 用于说明变更类别，常见值包括 `feat`、`fix`、`docs`、`test`、`refactor`、`chore`。
- `scope` 用于说明影响范围，应尽量使用模块名、文档名或功能名，例如 `product-requirements`、`parser`、`runner`、`codelens`。
- `summary` 使用简洁明确的中文动词短语，说明本次提交的核心意图。
- 不允许使用缺少前缀的提交信息，例如 `补充需求`、`更新文档`。
- 当任务包含产品需求、工作文档或测试记录变更时，应与实现代码一起提交，避免文档和代码脱节。
- 如果存在用户未要求的外部改动，必须保留这些改动，不得擅自回滚；提交时只纳入本次任务需要的文件。

### 11.6 代码注释要求

项目代码必须保持完整、清晰、可维护的注释体系。注释不是为了重复代码本身，而是为了说明模块职责、核心算法、边界条件、设计取舍和容易误解的行为。

必须添加注释的位置：

- 每个公开导出的函数、类型、接口、命令和配置项。
- parser、detector、locator、runner 等核心模块的入口方法。
- table-driven test 识别算法中的关键分支，例如 table 变量解析、range 变量映射、`t.Run` 参数解析、case name 回溯。
- 正则转义、Go test run pattern 构造、路径解析等容易出现细节错误的逻辑。
- 对不支持模式做出跳过判断的位置，必须说明为什么跳过。
- 异步流程、缓存、debounce、child process 调用等影响 VSCode extension host 稳定性的逻辑。
- 测试 fixture 中用于表达特殊场景的代码，必须说明该 fixture 覆盖的模式。

注释规范：

- 注释使用中文，必要的 API 名称、配置键、命令和代码标识符保留英文。
- 注释应解释“为什么这样做”和“这个分支保护了什么场景”，避免只复述代码。
- 修改已有逻辑时，应同步更新相关注释，禁止让注释与实际行为不一致。
- 对于复杂模块，应在文件顶部提供模块级注释，说明输入、输出、核心约束和不支持范围。

## 12. UX 要求

- 侧边栏应看起来像 VSCode 原生视图，而不是网页式控制台。
- 列表项高度、图标、hover action 和 context menu 应遵循 VSCode 习惯。
- 三个视图的信息密度应接近 Explorer/Test Explorer，不使用大卡片布局。
- 运行和调试按钮必须靠近对应目标。
- 删除列表项必须明确不会删除真实文件。
- 错误提示要短，详细诊断写入 output channel。
- 用户没有 Go 项目或没有测试时，空状态应安静，不持续弹窗。

## 13. 验收标准

第一阶段完成需满足：

- Activity Bar 中出现 Go Bench 侧边栏入口。
- Go Bench 侧边栏中按顺序展示文件、测试、运行与调试三个视图。
- 文件、测试、运行与调试三个视图不出现在 VSCode 原有资源管理器 Explorer 侧边栏中。
- 文件视图可浏览 workspace 文件，并可打开文件。
- 文件视图支持新建、重命名、删除和刷新。
- 测试视图展示与当前 Go Bench Test Explorer 一致的测试树。
- 测试视图支持运行和调试测试函数。
- 测试视图支持运行和调试可解析 table case。
- 运行与调试视图可以添加当前 Go 文件。
- 运行与调试视图可以删除列表项，且不删除真实文件。
- 点击 runnable 的 run 按钮可以在 terminal 中执行目标。
- 点击 runnable 的 debug 按钮可以启动 Go debug session。
- 插件重启后 runnable 列表仍然存在。
- multi-root workspace 下文件、测试和 runnable 都能正确标识所属 workspace。
- 自动化测试覆盖关键数据模型、命令构造和 manifest contribution。
- 对应里程碑文档记录实现范围、验证命令、手动验证步骤和已知问题。

## 14. 建议里程碑

### 14.1 里程碑 12：侧边栏框架

- 新增 Go Bench Activity Bar view container。
- 注册 Files、Tests、Run and Debug 三个空视图。
- 完成 manifest、命令和配置契约测试。

### 14.2 里程碑 13：文件视图

- 实现 workspace 文件树。
- 支持打开、刷新、新建、重命名和删除。
- 支持 multi-root workspace。

### 14.3 里程碑 14：测试视图迁移

- 将现有 Test Explorer 树模型映射到 Go Bench 侧边栏测试视图。
- 保持 run/debug/Test Results 行为一致。
- 补充测试视图刷新和状态同步。

### 14.4 里程碑 15：运行与调试列表

- 实现 runnable 数据模型和持久化。
- 支持添加当前文件、添加文件、添加 package。
- 支持 run/debug/delete/edit。
- 补充命令构造、debug 配置和持久化测试。

### 14.5 里程碑 16：运行与调试状态和分组批量操作补强

- 修复 runnable debug 启动、终止和视图状态同步。
- runnable 运行或调试中点击项目时聚焦对应结果视图：运行中回到 terminal，调试中回到 Debug Console；普通项目点击只选中节点，打开源码改由 Go to File inline action 执行。
- runnable 节点名称旁不展示 `package main` 或 `package unknown` 这类 description，package 信息只保留在 tooltip 中。
- 保留标准 debug inline 按钮：未运行项目显示 run/debug，运行或调试中显示 stop/restart。
- 调试运行中显示 Pause，调试暂停时显示 Continue、Step Over、Step Into、Step Out，并保留 stop/restart。
- 调试暂停时在 runnable 下展示当前 debug adapter 返回的调用栈帧，点击栈帧跳转到源码位置。
- 点击调试中 runnable 时聚焦 Debug Console；VSCode 扩展 API 不提供直接设置 active debug session 的稳定能力，因此多 debug session 下以 VSCode 当前 active debug session 的控制台标签为准。
- group 节点补充批量 debug、批量 stop、批量 restart 和批量删除项目入口。
- 停止 debug runnable 时同时停止 debug session，并尽力关闭 Debug Console 面板。

## 15. 待确认问题

已确认并纳入里程碑 16：

- 调试状态必须与 VSCode debug session 启动和终止事件同步；调试中的 runnable 点击项目时聚焦 Debug Console。
- 项目需要显示标准调试按钮；未运行时显示 run/debug，运行或调试中显示 stop/restart，避免动作混杂。
- 项目组需要批量 stop/restart、批量删除项目和批量调试按钮；点击项目本体不再直接跳转文件，打开源码保留为 Go to File action。
- 点击停止按钮停止调试时，需要停止对应 debug session，并尽力关闭 Debug Console 面板。

仍待确认：

- 文件视图是否必须完全替代 VSCode 原生 Explorer，还是只需要在 Go Bench 侧边栏中提供高频文件操作。
- runnable 列表第一阶段是否只支持 Go 目标，还是需要同时支持任意 shell command。
- runnable 配置应默认保存到 workspace settings，还是保存到 `.vscode/go-bench-runnables.json`。
- 测试视图是否需要和 VSCode 原生 Test Explorer 双向同步选择和展开状态。
- 运行与调试是否需要自动扫描 `package main` 并推荐加入列表。
