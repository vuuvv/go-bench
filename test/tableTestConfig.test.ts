/**
 * table-driven test 配置归一化测试。
 *
 * VSCode 用户配置可能被手动写成错误类型，CodeLens provider 依赖这里的兜底逻辑维持稳定行为。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defaultTableTestConfig } from '../src/constants';
import { normalizeTableTestConfig } from '../src/tableTestConfig';

describe('table test configuration normalization', () => {
  it('uses product defaults when raw values are absent', () => {
    assert.deepEqual(normalizeTableTestConfig(), defaultTableTestConfig);
  });

  it('keeps valid user values and filters invalid name fields', () => {
    assert.deepEqual(
      normalizeTableTestConfig({
        enabled: false,
        nameFields: ['title', '', 42],
        showFunctionRun: false,
        showCaseRun: true
      }),
      {
        enabled: false,
        nameFields: ['title'],
        showFunctionRun: false,
        showCaseRun: true
      }
    );
  });

  it('falls back to default name fields when configured fields are unusable', () => {
    assert.deepEqual(normalizeTableTestConfig({ nameFields: ['', 1] }).nameFields, defaultTableTestConfig.nameFields);
  });
});
