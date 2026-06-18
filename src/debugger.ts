/**
 * Go test debug 配置构造模块。
 *
 * 调试入口和运行入口共享同一个 `GoTestRunTarget`，因此这里复用 runner 的 `buildRunPattern` 和 package
 * 目录解析逻辑。真正启动调试由 VSCode extension 层调用 `vscode.debug.startDebugging` 完成。
 */

import { dirname } from 'node:path';
import { buildRunPattern, type GoTestRunTarget } from './runner';

/** 可直接交给 VSCode Go 扩展调试适配器的 launch configuration。 */
export type GoTestDebugConfiguration = {
  name: string;
  type: 'go';
  request: 'launch';
  mode: 'test';
  program: string;
  cwd: string;
  args: string[];
};

/**
 * 构造 Go test debug 配置。
 *
 * 官方 Go 调试适配器在 `mode: "test"` 下会编译并调试 package 测试二进制。Go 扩展自身的
 * Debug Test 命令使用 `["-test.run", pattern]`，这里保持同样格式，避免不同 adapter 对合并参数的
 * 解析不一致。
 */
export function buildGoTestDebugConfiguration(
  target: GoTestRunTarget
): GoTestDebugConfiguration {
  const packageDir = target.packageDir ?? dirname(target.file);
  const runPattern = buildRunPattern(target.testName, target.subtestPath);
  return {
    name: `Debug ${target.label}`,
    type: 'go',
    request: 'launch',
    mode: 'test',
    program: packageDir,
    cwd: packageDir,
    args: ['-test.run', runPattern]
  };
}
