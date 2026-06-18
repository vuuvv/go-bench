/**
 * Testing API 树模型测试。
 *
 * 真实 `vscode.TestController` 只能在 Extension Host 中完整验证；这里保护无 VSCode 依赖的纯函数层，
 * 确认 Testing API 原型和 CodeLens 一样复用 parser 元数据与 runner 目标。
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { GoTestFileParseResult, SourceRange } from '../src/parser';
import {
  createGoTestFileNodeId,
  createGoTestPackageNodeId,
  createGoTestTreeNodeId,
  createGoTestTreeNodes
} from '../src/testingTargets';

const range: SourceRange = {
  start: { line: 10, character: 2 },
  end: { line: 10, character: 30 }
};

const file = join('/', 'workspace', 'repo', 'pkg', 'normalize_test.go');

function parseResult(): GoTestFileParseResult {
  return {
    file,
    packageName: 'pkg',
    diagnostics: [],
    testFunctions: [
      {
        name: 'TestNormalize',
        file,
        range,
        nameRange: {
          start: { line: 5, character: 5 },
          end: { line: 5, character: 18 }
        },
        tableCases: [
          {
            id: `${file}:TestNormalize:empty input`,
            label: 'TestNormalize/empty input',
            file,
            testName: 'TestNormalize',
            subtestName: 'empty input',
            subtestPath: ['empty input'],
            range,
            confidence: 'exact'
          }
        ]
      }
    ]
  };
}

describe('Testing API target tree generation', () => {
  it('creates package and file roots before function and table case targets', () => {
    const [packageNode] = createGoTestTreeNodes(
      parseResult(),
      {
        showFunctionRun: true,
        showCaseRun: true
      },
      { workspaceRoot: join('/', 'workspace', 'repo') }
    );

    assert.equal(packageNode?.id, createGoTestPackageNodeId(join('/', 'workspace', 'repo', 'pkg')));
    assert.equal(packageNode?.label, './pkg');
    assert.equal(packageNode?.kind, 'package');
    assert.equal(packageNode?.runTarget, undefined);

    const [fileNode] = packageNode?.children ?? [];
    assert.equal(fileNode?.id, createGoTestFileNodeId(file));
    assert.equal(fileNode?.label, 'normalize_test.go');
    assert.equal(fileNode?.kind, 'file');
    assert.equal(fileNode?.runTarget, undefined);

    const [testFunction] = fileNode?.children ?? [];
    assert.equal(testFunction?.id, createGoTestTreeNodeId(file, 'TestNormalize'));
    assert.equal(testFunction?.label, 'TestNormalize');
    assert.equal(testFunction?.kind, 'function');
    assert.deepEqual(testFunction?.runTarget, {
      file,
      packageDir: join('/', 'workspace', 'repo', 'pkg'),
      testName: 'TestNormalize',
      subtestPath: [],
      label: 'TestNormalize'
    });

    const [child] = testFunction?.children ?? [];
    assert.equal(child?.id, createGoTestTreeNodeId(file, 'TestNormalize', ['empty input']));
    assert.equal(child?.label, 'empty input');
    assert.equal(child?.kind, 'case');
    assert.deepEqual(child?.runTarget?.subtestPath, ['empty input']);
  });

  it('honors Testing API prototype visibility switches', () => {
    assert.deepEqual(createGoTestTreeNodes(parseResult(), { showFunctionRun: false, showCaseRun: true }), []);

    const [root] = createGoTestTreeNodes(parseResult(), {
      showFunctionRun: true,
      showCaseRun: false
    });
    const [fileNode] = root?.children ?? [];
    const [testFunction] = fileNode?.children ?? [];
    assert.deepEqual(testFunction?.children, []);
  });
});
