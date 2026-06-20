# 里程碑 17 工作总结：Go Bench Panel Debug Console

## 实现范围

- 新增 VSCode 底部 panel container `Go Bench`，并在其中贡献 `Debug Console` webview。
- 每个 runnable debug session 在 Go Bench panel 中对应一个可切换 session tab，标题直接使用 runnable label，不显示 `Go Bench Debug:` 前缀。
- Go Bench panel 右侧使用树形结构展示 session，`Running` 和 `Ended` 作为根节点；已结束 session 按结束时间倒序排列，最多保留 100 条历史记录。
- session 节点标题单行省略，节点说明和 tooltip 展示运行时长、开始时间和结束时间。
- session 历史仅保存在扩展进程内存中；Ended 节点支持单条删除，右侧栏支持一次清空全部 Ended 历史。
- 通过 VSCode `DebugAdapterTracker` 监听 debug adapter 发出的 DAP `output` 事件，并把输出写入对应 runnable session。
- 输出类别保留差异：`stdout` / `console` 正常展示，`stderr` / `important` 等类别使用文本前缀标记，`telemetry` 不展示。
- Go Bench panel 支持清空当前 session 输出；debug session 停止或终止后保留历史输出，便于查看调试结果。
- Go Bench panel 内置 REPL 输入框，向当前 debug session 发送 `evaluate` 请求，`context` 为 `repl`；如果 VSCode 当前 active stack item 属于该 session，则携带当前 `frameId`。
- runnable 调试启动后聚焦 Go Bench panel 中对应 session；调试中点击 runnable 也回到该 session。

## 已知边界

- Go Bench panel 使用 webview 复刻 Debug Console；当前以文本形式展示 evaluate 结果、类型和 `variablesReference`，暂不提供原生 Debug Console 的富对象树展开 UI。
- CodeLens / Test Explorer 的 `Debug Test` 仍走原生 debug 启动流程；本里程碑优先解决 Go Bench Run and Debug runnable 的多 session 输出与聚焦问题。

## 关键文件

- `src/debugConsole.ts`：Go Bench Debug Console panel、webview UI、session 状态、清空输出和 evaluate 请求。
- `src/debugConsoleModel.ts`：DAP output 事件识别、换行归一化、debug session 标题和输出格式化。
- `src/runnables.ts`：runnable debug session 与 Go Bench panel 绑定、DAP tracker 接入、聚焦和生命周期清理。
- `package.json`：新增底部 `Go Bench` panel container、Debug Console webview 和 evaluate 命令贡献。
- `test/debugConsoleModel.test.ts`：保护 DAP 输出格式化和 session 标题契约。
- `test/manifest.test.ts`：保护 Go Bench panel manifest 贡献契约。
- `docs/sidebar-product-requirements.md`：新增里程碑 17。

## 验证命令

```sh
npm test
npm run lint
```

## 手动验证建议

- 在 Go Bench Run and Debug 中调试一个 runnable，确认底部 panel 出现 `Go Bench` tab，并在其中显示不带 `Go Bench Debug:` 前缀的 session。
- 同时调试两个 runnable，分别点击侧边栏中的调试中节点，确认 Go Bench panel 切换到各自的 debug session。
- 确认右侧 session 树分为 Running 和 Ended，已结束节点显示在 Ended 下并按结束时间倒序排列。
- 删除一条 Ended session，确认该历史记录从右侧树消失；点击 Clear Ended，确认所有已结束历史都被清空。
- 在 Go Bench panel 中点击 `Clear`，确认当前 session 输出可清空。
- 在断点暂停后，在 Go Bench panel 的输入框输入表达式并回车，确认 evaluate 结果显示在当前 session 中。
- 停止 debug session，确认 runnable 状态回到停止，同时 Go Bench panel 中该 session 历史仍可查看。
