/**
 * Go main CodeLens 目标测试。
 *
 * main CodeLens 复用 runnable 模型，因此这里重点保护可执行文件识别、`func main` 定位和 Run/Debug
 * CodeLens 传参，避免普通 Go 文件入口和 Run and Debug 侧边栏行为漂移。
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createGoMainCodeLensTargets, findMainFunctionRange } from '../src/mainCodeLensTargets';

describe('Go main CodeLens targets', () => {
  it('creates run and debug entries for executable main functions', () => {
    const workspaceRoot = join('/', 'workspace', 'repo');
    const file = join(workspaceRoot, 'cmd', 'api', 'main.go');
    const source = 'package main\n\nfunc main() {\n}\n';

    const targets = createGoMainCodeLensTargets({
      file,
      source,
      workspaceFolder: { name: 'repo', path: workspaceRoot },
      moduleName: 'example.com/repo',
      packageImportPath: 'cmd/api'
    });

    assert.equal(targets.length, 2);
    assert.deepEqual(targets.map(target => target.title), ['Run Main', 'Debug Main']);
    assert.deepEqual(targets[0].range, {
      start: { line: 2, character: 0 },
      end: { line: 2, character: 'func main('.length }
    });
    assert.equal(targets[0].runnable.label, 'example.com/repo/cmd/api');
    assert.equal(targets[0].runnable.kind, 'goFile');
    assert.equal(targets[0].runnable.packageName, 'main');
  });

  it('does not create entries for non-main packages or package main files without main functions', () => {
    const workspaceRoot = join('/', 'workspace', 'repo');
    const file = join(workspaceRoot, 'cmd', 'api', 'main.go');

    assert.deepEqual(
      createGoMainCodeLensTargets({
        file,
        source: 'package api\n\nfunc main() {}\n',
        workspaceFolder: { name: 'repo', path: workspaceRoot }
      }),
      []
    );
    assert.deepEqual(
      createGoMainCodeLensTargets({
        file,
        source: 'package main\n\nfunc helper() {}\n',
        workspaceFolder: { name: 'repo', path: workspaceRoot }
      }),
      []
    );
  });

  it('locates indented main function declarations', () => {
    assert.deepEqual(findMainFunctionRange('package main\n\n  func main() {}\n'), {
      start: { line: 2, character: 2 },
      end: { line: 2, character: 'func main('.length + 2 }
    });
  });
});
