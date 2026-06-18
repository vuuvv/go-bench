/**
 * Go test debug 配置构造模块。
 *
 * 调试入口和运行入口共享同一个 `GoTestRunTarget`，因此这里复用 runner 的 `buildRunPattern` 和 package
 * 目录解析逻辑。真正启动调试由 VSCode extension 层调用 `vscode.debug.startDebugging` 完成。
 */

import { dirname } from 'node:path';
import { buildRunPattern, type GoTestRunTarget } from './runner';

/** 调试启动需要的最小 workspace 信息。 */
export type GoTestDebugOptions = {
  /** VSCode workspace root，用于构造相对 package 参数和调试 cwd。 */
  workspaceRoot: string;
};

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
 * 官方 Go 调试适配器在 `mode: "test"` 下会编译并调试 package 测试二进制。`-test.run` 必须使用
 * testing 二进制参数形式，而不是 `go test -run`，所以这里只复用 pattern，不复用完整 shell 命令。
 */
export function buildGoTestDebugConfiguration(
  target: GoTestRunTarget,
  options: GoTestDebugOptions
): GoTestDebugConfiguration {
  const packageDir = target.packageDir ?? dirname(target.file);
  return {
    name: `Debug ${target.label}`,
    type: 'go',
    request: 'launch',
    mode: 'test',
    program: packageDir,
    cwd: options.workspaceRoot,
    args: ['-test.run', buildRunPattern(target.testName, target.subtestPath)]
  };
}
