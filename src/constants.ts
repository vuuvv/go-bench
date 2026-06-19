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
  toggleTestTreeModeFromStandardGo: 'goBench.toggleTestTreeModeFromStandardGo'
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
  testingApiTreeMode: 'goBench.tableTests.testingApi.treeMode'
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
