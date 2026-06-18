/**
 * Go module 解析测试。
 *
 * Test Explorer 树的第一层依赖这里找到最近的有效 go.mod，并显示其中的 module path。
 */

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { parseGoModuleName, resolveGoModuleInfo } from '../src/goModule';

describe('Go module resolution', () => {
  it('parses module names from go.mod content', () => {
    assert.equal(parseGoModuleName('module example.com/repo\n\ngo 1.22\n'), 'example.com/repo');
    assert.equal(parseGoModuleName('// comment\nmodule github.com/acme/project\n'), 'github.com/acme/project');
    assert.equal(parseGoModuleName('module example.com/repo // trailing comment\n'), 'example.com/repo');
    assert.equal(parseGoModuleName('module "example.com/quoted"\n'), 'example.com/quoted');
    assert.equal(parseGoModuleName('go 1.22\n'), undefined);
  });

  it('finds the nearest go.mod from a nested Go test file', () => {
    const root = mkdtempSync(join(tmpdir(), 'go-bench-module-'));
    try {
      const moduleDir = join(root, 'repo');
      const packageDir = join(moduleDir, 'internal', 'normalize');
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(join(moduleDir, 'go.mod'), 'module example.com/repo\n');

      const file = join(packageDir, 'normalize_test.go');
      assert.deepEqual(resolveGoModuleInfo(file), {
        dir: moduleDir,
        name: 'example.com/repo'
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
