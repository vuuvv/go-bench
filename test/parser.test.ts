/**
 * parser 里程碑测试。
 *
 * 这些测试直接驱动 Go helper parser，保护第一阶段退出标准：识别 `_test.go` 中的测试函数、
 * 返回 VSCode 兼容源码 range，并在语法未完成时给出可恢复诊断而不是让调用方崩溃。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { GoHelperParser, isGoTestFile } from '../src/parser';

const fixtureRoot = join(process.cwd(), 'test', 'fixtures', 'parser');
const parser = new GoHelperParser({ timeoutMs: 15_000 });

function readFixture(name: string): { file: string; source: string } {
  const file = join(fixtureRoot, name);
  return {
    file,
    source: readFileSync(file, 'utf8')
  };
}

describe('Go helper parser', () => {
  it('detects Go test files by suffix', () => {
    assert.equal(isGoTestFile('/workspace/foo_test.go'), true);
    assert.equal(isGoTestFile('/workspace/foo.go'), false);
  });

  it('extracts test functions with source ranges from a valid _test.go file', async () => {
    const fixture = readFixture('basic_test.go');
    const result = await parser.parseTestFile(fixture.file, fixture.source);

    assert.equal(result.file, fixture.file);
    assert.equal(result.packageName, 'parserfixture');
    assert.deepEqual(
      result.testFunctions.map(testFunction => testFunction.name),
      ['TestAlpha', 'TestSecond']
    );
    assert.deepEqual(result.diagnostics, []);

    const [first] = result.testFunctions;
    assert.equal(first?.range.start.line, 5);
    assert.equal(first?.range.start.character, 0);
    assert.deepEqual(first?.nameRange.start, { line: 5, character: 5 });
    assert.deepEqual(first?.nameRange.end, { line: 5, character: 14 });
  });

  it('skips files that are not named _test.go before invoking Go parsing work', async () => {
    const fixture = readFixture('plain.go');
    const result = await parser.parseTestFile(fixture.file, fixture.source);

    assert.equal(result.file, fixture.file);
    assert.equal(result.packageName, '');
    assert.deepEqual(result.testFunctions, []);
    assert.deepEqual(result.diagnostics, []);
  });

  it('returns diagnostics for incomplete syntax while preserving complete test functions', async () => {
    const fixture = readFixture('incomplete_test.go');
    const result = await parser.parseTestFile(fixture.file, fixture.source);

    assert.equal(result.packageName, 'parserfixture');
    assert.equal(result.testFunctions[0]?.name, 'TestCompleteBeforeError');
    assert.ok(result.diagnostics.length > 0);
    assert.equal(result.diagnostics[0]?.severity, 'error');
  });
});
