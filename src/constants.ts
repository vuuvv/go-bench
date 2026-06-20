/**
 * 本模块集中维护扩展早期骨架需要共享的命令、频道和配置默认值。
 * 里程碑 0 尚未接入 parser 和 CodeLens，这里先把稳定的标识符收口，避免后续模块各自硬编码。
 */

/** Go Bench 扩展贡献的命令 ID 集合。 */
export const commands = {
  /** no-op 命令用于验证扩展激活、命令注册和 output channel 是否可用。 */
  noop: 'goBench.noop',
  /** 从 CodeLens 触发 `go test -run` 的命令入口。 */
  runTest: 'goBench.runTest',
  /** 从 CodeLens 或 Test Explorer 触发 Go test debug 的命令入口。 */
  debugTest: 'goBench.debugTest',
  /** 重新扫描 workspace 并刷新实验 Testing API 测试树。 */
  refreshTestTree: 'goBench.refreshTestTree',
  /** 只刷新当前 Go 测试文件在实验 Testing API 测试树中的节点。 */
  refreshCurrentFileTestTree: 'goBench.refreshCurrentFileTestTree',
  /** 在 Go Bench table case 树和标准 Go 函数级测试树之间切换。 */
  toggleTestTreeMode: 'goBench.toggleTestTreeMode',
  /** Test Explorer 标题区：当前为 Go Bench 树，点击切换到标准 Go 树。 */
  toggleTestTreeModeFromGoBench: 'goBench.toggleTestTreeModeFromGoBench',
  /** Test Explorer 标题区：当前为标准 Go 树，点击切换到 Go Bench 树。 */
  toggleTestTreeModeFromStandardGo: 'goBench.toggleTestTreeModeFromStandardGo',
  /** Go Bench 侧边栏 Files 视图标题区刷新入口。 */
  refreshSidebarFiles: 'goBench.sidebar.refreshFiles',
  /** Go Bench 侧边栏 Tests 视图标题区刷新入口。 */
  refreshSidebarTests: 'goBench.sidebar.refreshTests',
  /** 在 Go Bench Tests 视图中定位当前编辑器文件对应的测试节点。 */
  revealCurrentSidebarTest: 'goBench.sidebar.tests.revealCurrentFile',
  /** 运行 Go Bench Tests 视图中的测试函数或 table case。 */
  runSidebarTest: 'goBench.sidebar.tests.run',
  /** 调试 Go Bench Tests 视图中的测试函数或 table case。 */
  debugSidebarTest: 'goBench.sidebar.tests.debug',
  /** 打开 Go Bench Files 视图中的文件。 */
  openSidebarFile: 'goBench.sidebar.files.open',
  /** 在旁边打开 Go Bench Files 视图中的文件。 */
  openSidebarFileToSide: 'goBench.sidebar.files.openToSide',
  /** 使用 VSCode Open With 流程打开 Go Bench Files 视图中的文件。 */
  openSidebarFileWith: 'goBench.sidebar.files.openWith',
  /** 在 Go Bench Files 视图中新建文件。 */
  newSidebarFile: 'goBench.sidebar.files.newFile',
  /** 在 Go Bench Files 视图中新建文件夹。 */
  newSidebarFolder: 'goBench.sidebar.files.newFolder',
  /** 剪切 Go Bench Files 视图中的文件或文件夹。 */
  cutSidebarFile: 'goBench.sidebar.files.cut',
  /** 复制 Go Bench Files 视图中的文件或文件夹。 */
  copySidebarFile: 'goBench.sidebar.files.copy',
  /** 粘贴到 Go Bench Files 视图中的文件夹。 */
  pasteSidebarFile: 'goBench.sidebar.files.paste',
  /** 重命名 Go Bench Files 视图中的文件或文件夹。 */
  renameSidebarFile: 'goBench.sidebar.files.rename',
  /** 删除 Go Bench Files 视图中的文件或文件夹。 */
  deleteSidebarFile: 'goBench.sidebar.files.delete',
  /** 在 Go Bench Files 视图中的目录内搜索。 */
  findInSidebarFolder: 'goBench.sidebar.files.findInFolder',
  /** 在系统文件管理器中显示 Go Bench Files 视图中的目标。 */
  revealSidebarFile: 'goBench.sidebar.files.reveal',
  /** 复制 Go Bench Files 视图中目标相对 workspace 的路径。 */
  copySidebarRelativePath: 'goBench.sidebar.files.copyRelativePath',
  /** 复制 Go Bench Files 视图中目标绝对路径。 */
  copySidebarAbsolutePath: 'goBench.sidebar.files.copyAbsolutePath',
  /** 将当前编辑器文件添加到 Go Bench Run and Debug 列表。 */
  addCurrentRunnableFile: 'goBench.runnables.addCurrentFile',
  /** 通过文件选择器添加 Go 文件运行目标。 */
  addRunnableFile: 'goBench.runnables.addFile',
  /** 通过目录选择器添加 Go package 运行目标。 */
  addRunnablePackage: 'goBench.runnables.addPackage',
  /** 扫描 workspace 中所有可执行 Go 文件并批量加入 Run and Debug。 */
  scanRunnableFiles: 'goBench.runnables.scanFiles',
  /** 创建 Run and Debug runnable 分组。 */
  createRunnableGroup: 'goBench.runnables.createGroup',
  /** 将 Run and Debug runnable 归档到分组或移回根层级。 */
  moveRunnableToGroup: 'goBench.runnables.moveToGroup',
  /** 批量运行 Run and Debug 分组中的所有 runnable。 */
  runRunnableGroup: 'goBench.runnables.runGroup',
  /** 批量停止 Run and Debug 分组中正在运行的 runnable。 */
  stopRunnableGroup: 'goBench.runnables.stopGroup',
  /** 批量重启 Run and Debug 分组中的 runnable。 */
  restartRunnableGroup: 'goBench.runnables.restartGroup',
  /** 批量调试 Run and Debug 分组中的 runnable。 */
  debugRunnableGroup: 'goBench.runnables.debugGroup',
  /** 批量删除 Run and Debug 分组中的 runnable；只移除列表项，不删除真实文件。 */
  removeRunnableGroupItems: 'goBench.runnables.removeGroupItems',
  /** 删除 Run and Debug runnable 分组但保留其中项目。 */
  removeRunnableGroup: 'goBench.runnables.removeGroup',
  /** 从 Go Bench Run and Debug 列表移除运行目标。 */
  removeRunnable: 'goBench.runnables.remove',
  /** 编辑 Go Bench Run and Debug 列表中的运行目标。 */
  editRunnable: 'goBench.runnables.edit',
  /** 在 terminal 中运行 Go Bench runnable。 */
  runRunnable: 'goBench.runnables.run',
  /** 停止 Go Bench runnable 当前 terminal。 */
  stopRunnable: 'goBench.runnables.stop',
  /** 重启 Go Bench runnable 当前 terminal。 */
  restartRunnable: 'goBench.runnables.restart',
  /** 使用官方 Go debug adapter 调试 Go Bench runnable。 */
  debugRunnable: 'goBench.runnables.debug',
  /** 打开 Go Bench runnable 对应的文件或目录。 */
  revealRunnable: 'goBench.runnables.reveal',
  /** 聚焦 Go Bench runnable 对应的 Debug Console。 */
  focusRunnableDebugConsole: 'goBench.runnables.focusDebugConsole',
  /** 聚焦 Go Bench runnable 当前运行或调试结果视图。 */
  focusRunnableResult: 'goBench.runnables.focusResult',
  /** 复制 Go Bench runnable 的绝对路径。 */
  copyRunnablePath: 'goBench.runnables.copyPath'
} as const;

/** Go Bench 侧边栏贡献的 view container 和 view ID。 */
export const sidebarViewIds = {
  /** Activity Bar 中的 Go Bench 容器。 */
  container: 'go-bench-sidebar',
  /** 文件视图，里程碑 13 会接入 workspace 文件树。 */
  files: 'goBench.sidebar.files',
  /** 测试视图，里程碑 14 会映射当前 Testing API 树模型。 */
  tests: 'goBench.sidebar.tests',
  /** 运行与调试视图，里程碑 15 会接入 runnable 列表。 */
  runAndDebug: 'goBench.sidebar.runAndDebug'
} as const;

/** VSCode when-clause context keys，用于让 Test Explorer 标题区显示当前树模式的图标按钮。 */
export const contextKeys = {
  /** 当前 Testing API 树模式为 Go Bench 增强树。 */
  testTreeModeGoBench: 'goBench.testTreeMode.goBench',
  /** 当前 Testing API 树模式为标准 Go 函数级树。 */
  testTreeModeStandardGo: 'goBench.testTreeMode.standardGo'
} as const;

/** VSCode output channel 名称，后续 runner 会复用同一个频道展示 `go test` 输出。 */
export const outputChannelName = 'Go Bench';

/** table-driven test 识别相关配置键，保持与 `package.json` contributed configuration 一致。 */
export const configurationKeys = {
  /** 是否启用 table-driven test 识别。 */
  enabled: 'goBench.tableTests.enabled',
  /** 可作为 subtest name 的 table entry 字段名。 */
  nameFields: 'goBench.tableTests.nameFields',
  /** 是否展示函数级运行入口。 */
  showFunctionRun: 'goBench.tableTests.showFunctionRun',
  /** 是否展示 case 级运行入口。 */
  showCaseRun: 'goBench.tableTests.showCaseRun',
  /** 是否启用实验性的 VSCode Testing API 测试树原型。 */
  testingApiEnabled: 'goBench.tableTests.testingApi.enabled',
  /** Testing API 测试树展示模式。 */
  testingApiTreeMode: 'goBench.tableTests.testingApi.treeMode',
  /** 是否启用 Go Bench 侧边栏。 */
  sidebarEnabled: 'goBench.sidebar.enabled',
  /** 是否启用 Go Bench 侧边栏 Files 视图。 */
  sidebarFilesEnabled: 'goBench.sidebar.files.enabled',
  /** 是否启用 Go Bench 侧边栏 Tests 视图。 */
  sidebarTestsEnabled: 'goBench.sidebar.tests.enabled',
  /** 是否启用 Go Bench 侧边栏 Run and Debug 视图。 */
  sidebarRunnablesEnabled: 'goBench.sidebar.runnables.enabled',
  /** workspace 级持久化的 Run and Debug runnable 列表。 */
  runnableItems: 'goBench.runnables.items',
  /** workspace 级持久化的 Run and Debug runnable 分组。 */
  runnableGroups: 'goBench.runnables.groups',
  /** runnable 是否默认在 VSCode terminal 中执行。 */
  runnablesDefaultRunInTerminal: 'goBench.runnables.defaultRunInTerminal'
} as const;

/** 官方 Go 扩展的 Test Explorer 开关，用于和 Go Bench 测试树互斥显示。 */
export const standardGoTestExplorerConfigurationKey = 'go.testExplorer.enable';

/** 里程碑 0 对配置默认值做单元测试，防止 manifest 和代码侧配置漂移。 */
export const defaultTableTestConfig = {
  enabled: true,
  nameFields: ['name', 'desc', 'caseName', 'title'],
  showFunctionRun: true,
  showCaseRun: true,
  testingApiEnabled: true,
  testingApiTreeMode: 'goBench'
} as const;

/** 侧边栏里程碑 12 的默认配置。 */
export const defaultSidebarConfig = {
  enabled: true,
  filesEnabled: true,
  testsEnabled: true,
  runnablesEnabled: true,
  runnableItems: [],
  runnableGroups: [],
  runnablesDefaultRunInTerminal: true
} as const;
