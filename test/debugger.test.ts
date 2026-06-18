/**
 * Go test debug 配置测试。
 *
 * 调试入口不直接执行 `go test`，而是交给官方 Go 调试适配器启动测试二进制；这些断言保护
 * `mode: "test"` 和 `-test.run` 参数，避免 Debug Case 和 Run Case 选中不同目标。
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { buildGoTestDebugConfiguration } from '../src/debugger';
import type { GoTestRunTarget } from '../src/runner';

describe('go test debug configuration', () => {
  it('builds a Go test launch configuration for a table case', () => {
    const workspaceRoot = join('/', 'workspace', 'repo');
    const target: GoTestRunTarget = {
      file: join(workspaceRoot, 'pkg', 'normalize_test.go'),
      packageDir: join(workspaceRoot, 'pkg'),
      testName: 'TestNormalize',
      subtestPath: ['case with spaces', 'regex .* chars'],
      label: 'TestNormalize/case with spaces'
    };

    assert.deepEqual(buildGoTestDebugConfiguration(target, { workspaceRoot }), {
      name: 'Debug TestNormalize/case with spaces',
      type: 'go',
      request: 'launch',
      mode: 'test',
      program: join(workspaceRoot, 'pkg'),
      cwd: workspaceRoot,
      args: ['-test.run', '^TestNormalize$/^case_with_spaces$/^regex_\\.\\*_chars$']
    });
  });
});
