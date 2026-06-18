/**
 * table-driven test 配置归一化。
 *
 * VSCode configuration API 返回的是用户可编辑的未知值，本模块把这些值收敛为扩展内部稳定类型。
 * CodeLens provider 每次解析前读取配置，因此这里也承担默认值兜底，避免配置写坏时误显示或误隐藏入口。
 */

import { defaultTableTestConfig } from './constants';

/** table-driven test 运行入口使用的内部配置。 */
export type TableTestConfig = {
  /** 是否启用 Go table-driven test 识别和 CodeLens。 */
  enabled: boolean;
  /** 可作为静态 subtest 名称的 table entry 字段。 */
  nameFields: string[];
  /** 是否展示整个测试函数的 `Run Test` 入口。 */
  showFunctionRun: boolean;
  /** 是否展示单个 table case 的 `Run Case` 入口。 */
  showCaseRun: boolean;
  /** 是否启用实验性的 VSCode Testing API 测试树。 */
  testingApiEnabled: boolean;
};

/** 用户配置的原始形状，测试和 VSCode 适配层都可以按需传入局部字段。 */
export type RawTableTestConfig = Partial<Record<keyof TableTestConfig, unknown>>;

/**
 * 将未知配置值归一化为内部配置。
 *
 * 这里不直接信任数组内容，是为了保护 parser helper：空字符串或非字符串字段名没有可识别语义，
 * 传给 helper 只会让后续定位逻辑更难解释。
 */
export function normalizeTableTestConfig(raw: RawTableTestConfig = {}): TableTestConfig {
  const nameFields = Array.isArray(raw.nameFields)
    ? raw.nameFields.filter((field): field is string => typeof field === 'string' && field.trim() !== '')
    : [...defaultTableTestConfig.nameFields];

  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : defaultTableTestConfig.enabled,
    nameFields: nameFields.length > 0 ? nameFields : [...defaultTableTestConfig.nameFields],
    showFunctionRun:
      typeof raw.showFunctionRun === 'boolean' ? raw.showFunctionRun : defaultTableTestConfig.showFunctionRun,
    showCaseRun: typeof raw.showCaseRun === 'boolean' ? raw.showCaseRun : defaultTableTestConfig.showCaseRun,
    testingApiEnabled:
      typeof raw.testingApiEnabled === 'boolean'
        ? raw.testingApiEnabled
        : defaultTableTestConfig.testingApiEnabled
  };
}
