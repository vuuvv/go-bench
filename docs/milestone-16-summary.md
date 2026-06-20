# 里程碑 16 工作总结：运行与调试状态和分组批量操作补强

## 实现范围

- runnable debug 启动后立即进入 `debugging` 状态，并通过 VSCode `onDidStartDebugSession` / `onDidTerminateDebugSession` 事件补齐 session 映射和终止同步。
- 运行或调试中的 runnable 节点点击后聚焦对应结果视图：运行中回到 terminal，调试中回到 Debug Console；未运行节点点击只选中节点，不再直接打开文件。
- runnable 节点不再展示 `package main` 或 `package unknown` 这类 description，package 信息只保留在 tooltip 中。
- 点击 debug 按钮启动调试时不主动切换到 VSCode Debug 侧边栏或 Debug Console，保持用户当前工作区焦点。
- 调试运行中显示 Pause 按钮，并展示禁用态 Step Over、Step Into、Step Out；调试暂停时显示 Continue、Step Over、Step Into、Step Out 按钮，并保留 stop/restart。
- 调试控制按钮委托 VSCode 原生 debug 命令执行，避免直接发送 DAP step/pause 请求时和 Go debug adapter 的线程上下文不一致。
- 调试暂停时读取 debug adapter 的 `stackTrace`，在 runnable 下展示当前调用栈帧，点击栈帧跳转到源码位置。
- 打开源码保留为 runnable 的 `Go to File` inline action。
- runnable 未运行时显示 run/debug inline 按钮；运行或调试中显示 stop/restart inline 按钮。
- group 节点新增批量 debug 按钮，可依次启动组内 runnable 调试。
- group 节点新增批量删除项目按钮，只移除 Go Bench 列表项，不删除真实文件。
- group 节点保留批量 run，并在存在运行或调试中项目时显示批量 stop/restart。
- 停止 debug runnable 时调用 VSCode debug stop，并尽力关闭 Debug Console 面板。

## 已知边界

- VSCode 扩展 API 可以聚焦 Debug Console，但不能稳定地直接设置某个 debug session 为 active；多 debug session 同时存在时，Debug Console 的具体标签选择仍遵循 VSCode 当前 active debug session。
- 暂停堆栈来自 debug adapter 的 `stackTrace` 响应；如果 adapter 没有返回 source path，则该栈帧只展示名称，不提供源码跳转。

## 关键文件

- `src/runnables.ts`：debug session 状态同步、runnable 点击行为、group 批量 debug/delete、停止调试后的面板清理。
- `src/constants.ts`：新增 group debug、group items remove 和 focus debug console 命令 ID。
- `package.json`：新增命令贡献和 Run and Debug group inline action。
- `test/constants.test.ts`：保护新增命令 ID。
- `test/manifest.test.ts`：保护新增命令和菜单贡献契约。
- `docs/sidebar-product-requirements.md`：将待确认问题前 4 项转为里程碑 16 决策。

## 验证命令

```sh
npm test
npm run lint
```

## 手动验证建议

- 调试一个 runnable，确认节点切换到 debug 图标和 stop/restart 按钮。
- 调试中点击 runnable 节点，确认聚焦 Debug Console；点击 Go to File 才跳转源码。
- 点击 stop，确认 debug session 停止，节点回到未运行状态，Debug Console 面板被关闭或保持 VSCode 默认清理行为。
- 创建 group 后点击 debug group，确认组内项目依次启动调试。
- 点击 group remove items，确认只从 Go Bench 列表移除组内 runnable，真实文件不删除。
