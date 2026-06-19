# 里程碑 13 工作总结：文件视图

## 完成功能范围

- 将 Go Bench 侧边栏 `Files` 视图从空 tree view 升级为 workspace 文件树。
- 默认隐藏 workspace 根目录本身，顶层直接展示 workspace 根目录下的子文件和子目录。
- 支持 multi-root workspace，并为每个顶层子项保留所属 workspace 信息。
- 支持目录懒加载，并按目录优先、名称自然排序展示。
- 支持点击文件打开编辑器。
- 支持刷新文件树。
- 支持新建文件、新建文件夹、重命名、删除。
- 支持打开到旁边、Open With、剪切、复制、粘贴和在文件夹中搜索。
- 支持复制相对路径、复制绝对路径、在系统文件管理器中显示。
- 支持文件系统变化后自动刷新。

## 核心文件和模块

- `src/fileExplorer.ts`：Files 视图的 TreeDataProvider、文件操作命令和文件系统 watcher。
- `src/fileExplorerModel.ts`：文件树排序和输入校验的纯 TypeScript 工具。
- `src/sidebar.ts`：把 Files 视图接入真实文件树，Tests / Run and Debug 暂时保持空视图。
- `src/constants.ts`：新增 Files 视图相关命令 ID。
- `package.json`：新增 Files 视图标题区按钮和右键菜单。
- `test/fileExplorerModel.test.ts`：覆盖文件排序和用户输入校验。
- `test/manifest.test.ts`：覆盖新增命令和菜单贡献契约。

## 实现思路与设计取舍

- 文件树使用 `vscode.workspace.fs.readDirectory` 懒加载目录，避免启动时扫描整个仓库。
- TreeItem 使用 `resourceUri`，让 VSCode 尽量应用当前主题的文件/目录图标和资源装饰。
- 文件操作使用 VSCode workspace/fs API，打开文件、系统 reveal 和 clipboard 复用 VSCode 原生命令/API。
- Go Bench Files 不能直接继承 VSCode 原生 Explorer 的内部实现和第三方 `explorer/context` 菜单，因此在自己的 `view/item/context` 中复刻 Explorer 核心菜单结构。
- 重命名限制为同目录单名，不在第一阶段承担移动文件职责。
- 删除使用确认弹窗和 `useTrash: true`，避免误删时没有回退余地。

## 已支持和不支持的模式

- 已支持：
  - 隐藏 workspace 根节点，直接展示其下级文件和目录。
  - 文件/目录展开。
  - 打开文件。
  - 打开到旁边。
  - Open With。
  - 新建文件和文件夹。
  - 剪切、复制、粘贴文件或文件夹。
  - 重命名文件和文件夹。
  - 删除文件和文件夹。
  - 在文件夹中搜索。
  - 复制相对路径和绝对路径。
  - 在系统文件管理器中显示目标。
  - 文件变化自动刷新。
- 暂不支持：
  - `.gitignore` 过滤。
  - Git 状态装饰完整复刻。
  - 自动继承 VSCode 内部或第三方扩展贡献到原生 Explorer 的所有右键菜单。
  - 拖拽移动文件。
  - 与 VSCode 原生 Explorer 展开状态同步。
  - 右键添加到 Run and Debug。

## 测试记录

- 命令：`npm test`
- 结果：通过，61 个测试全部通过。
- 命令：`npm run lint`
- 结果：通过。
- 未覆盖风险：当前未启动真实 VSCode Extension Host 做手动视觉验证，文件操作行为主要依赖 TypeScript 编译、manifest 契约测试和纯模型单测保护。

## 已知问题和后续计划

- 已知问题：Files 视图当前不处理大型目录的分页或过滤；超大目录仍依赖 VSCode tree view 的基础懒加载能力。
- 后续计划：里程碑 14 接入 Tests 视图，将现有 Testing API 树模型映射到 Go Bench 侧边栏。
- 待确认问题：是否在 Files 视图第一阶段就加入 `.gitignore` / exclude 配置，还是留到文件视图增强阶段。
