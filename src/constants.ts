/**
 * 本模块集中维护扩展早期骨架需要共享的命令、频道和配置默认值。
 * 里程碑 0 尚未接入 parser 和 CodeLens，这里先把稳定的标识符收口，避免后续模块各自硬编码。
 */

/** Go Plus 扩展贡献的命令 ID 集合。 */
export const commands = {
  /** no-op 命令用于验证扩展激活、命令注册和 output channel 是否可用。 */
  noop: 'goPlus.noop'
} as const;

/** VSCode output channel 名称，后续 runner 会复用同一个频道展示 `go test` 输出。 */
export const outputChannelName = 'Go Plus';

/** table-driven test 识别相关配置键，保持与 `package.json` contributed configuration 一致。 */
export const configurationKeys = {
  /** 是否启用 table-driven test 识别。 */
  enabled: 'goPlus.tableTests.enabled',
  /** 可作为 subtest name 的 table entry 字段名。 */
  nameFields: 'goPlus.tableTests.nameFields',
  /** 是否展示函数级运行入口。 */
  showFunctionRun: 'goPlus.tableTests.showFunctionRun',
  /** 是否展示 case 级运行入口。 */
  showCaseRun: 'goPlus.tableTests.showCaseRun'
} as const;

/** 里程碑 0 对配置默认值做单元测试，防止 manifest 和代码侧配置漂移。 */
export const defaultTableTestConfig = {
  enabled: true,
  nameFields: ['name', 'desc', 'caseName', 'title'],
  showFunctionRun: true,
  showCaseRun: true
} as const;
