# 里程碑 17 工作总结：Go Bench Output Debug Console

## 实现范围

- 新增 Go Bench Output Debug Console，每个 runnable debug session 对应独立 Output view channel，名称为 `Go Bench Debug: <label>`。
- 通过 VSCode `DebugAdapterTracker` 监听 debug adapter 发出的 DAP `output` 事件，并把输出写入对应 runnable 的 Output view。
- 输出类别保留差异：`stdout` / `console` 正常展示，`stderr` / `important` 等类别使用文本前缀标记，`telemetry` 不展示。
- Output view 支持 VSCode 原生清空输出能力；debug session 停止或终止后保留历史输出，便于查看调试结果。
- 新增 `Evaluate in Debug Console` 命令，向当前 debug session 发送 `evaluate` 请求，`context` 为 `repl`；如果 VSCode 当前 active stack item 属于该 session，则携带当前 `frameId`。
- runnable 调试启动后聚焦对应 Output view；调试中点击 runnable 也回到该 Output view。

## 已知边界

- VSCode Output view 不提供内联输入框和富对象树展开 UI；REPL evaluate 通过 `Evaluate in Debug Console` 命令输入，并把结果写回同一个 Output view。
- CodeLens / Test Explorer 的 `Debug Test` 仍走原生 debug 启动流程；本里程碑优先解决 Go Bench Run and Debug runnable 的多 session 输出与聚焦问题。

## 关键文件

- `src/debugConsole.ts`：Go Bench Output Debug Console、OutputChannel 管理和 evaluate 请求。
- `src/debugConsoleModel.ts`：DAP output 事件识别、换行归一化、Output channel 命名和输出格式化。
- `src/runnables.ts`：runnable debug session 与 Output view 绑定、DAP tracker 接入、聚焦和生命周期清理。
- `test/debugConsoleModel.test.ts`：保护 DAP 输出格式化和 Output channel 命名契约。
- `docs/sidebar-product-requirements.md`：新增里程碑 17。

## 验证命令

```sh
npm test
npm run lint
```

## 手动验证建议

- 在 Go Bench Run and Debug 中调试一个 runnable，确认打开 `Go Bench Debug: <label>` Output view 并持续显示调试输出。
- 同时调试两个 runnable，分别点击侧边栏中的调试中节点，确认聚焦到各自的 Go Bench Debug Output view。
- 在 Output view 中使用 VSCode 原生清空按钮，确认当前 channel 输出可清空。
- 在断点暂停后，对调试中的 runnable 执行 `Evaluate in Debug Console`，输入表达式并确认 evaluate 结果显示在对应 Output view 中。
- 停止 debug session，确认 runnable 状态回到停止，同时 Output view 历史仍可查看。
