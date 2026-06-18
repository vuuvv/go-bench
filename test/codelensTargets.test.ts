/**
 * CodeLens 目标生成测试。
 *
 * 真实 `vscode.CodeLens` 类型只能在 Extension Host 中完整运行；这里测试不依赖 VSCode API 的纯函数层，
 * 覆盖 provider 最核心的行为：函数级和 case 级入口是否按配置显示，以及 runner 参数是否正确。
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createGoTestCodeLensTargets } from '../src/codelensTargets';
import type { GoTestFileParseResult, SourceRange } from '../src/parser';

const range: SourceRange = {
  start: { line: 3, character: 2 },
  end: { line: 3, character: 20 }
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

describe('CodeLens target generation', () => {
  it('creates function and table case run targets from parser metadata', () => {
    const targets = createGoTestCodeLensTargets(parseResult(), {
      showFunctionRun: true,
      showCaseRun: true
    });

    assert.deepEqual(
      targets.map(target => target.title),
      ['Run Test', 'Run Case']
    );
    assert.deepEqual(targets[0]?.runTarget, {
      file,
      packageDir: join('/', 'workspace', 'repo', 'pkg'),
      testName: 'TestNormalize',
      subtestPath: [],
      label: 'TestNormalize'
    });
    assert.deepEqual(targets[1]?.runTarget.subtestPath, ['empty input']);
    assert.deepEqual(targets[1]?.range, range);
  });

  it('honors function and case CodeLens visibility settings', () => {
    assert.deepEqual(
      createGoTestCodeLensTargets(parseResult(), { showFunctionRun: false, showCaseRun: true }).map(
        target => target.title
      ),
      ['Run Case']
    );
    assert.deepEqual(
      createGoTestCodeLensTargets(parseResult(), { showFunctionRun: true, showCaseRun: false }).map(
        target => target.title
      ),
      ['Run Test']
    );
  });
});
