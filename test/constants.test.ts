/**
 * 里程碑 0 的基础测试聚焦在稳定契约：命令 ID、output channel 和默认配置。
 * 这些值会被 `package.json`、后续 CodeLens provider 和 runner 共同依赖，先用轻量测试保护漂移风险。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { commands, configurationKeys, defaultTableTestConfig, outputChannelName } from '../src/constants';

describe('extension skeleton constants', () => {
  it('uses the contributed no-op command id', () => {
    assert.equal(commands.noop, 'goBench.noop');
    assert.equal(commands.runTest, 'goBench.runTest');
    assert.equal(commands.debugTest, 'goBench.debugTest');
    assert.equal(commands.refreshTestTree, 'goBench.refreshTestTree');
    assert.equal(commands.refreshCurrentFileTestTree, 'goBench.refreshCurrentFileTestTree');
    assert.equal(commands.toggleTestTreeMode, 'goBench.toggleTestTreeMode');
  });

  it('uses a stable output channel name', () => {
    assert.equal(outputChannelName, 'Go Bench');
  });

  it('keeps table test defaults aligned with milestone 0 requirements', () => {
    assert.deepEqual(defaultTableTestConfig, {
      enabled: true,
      nameFields: ['name', 'desc', 'caseName', 'title'],
      showFunctionRun: true,
      showCaseRun: true,
      testingApiEnabled: false,
      testingApiTreeMode: 'goBench'
    });
  });

  it('defines configuration keys under the goBench.tableTests namespace', () => {
    assert.deepEqual(Object.values(configurationKeys), [
      'goBench.tableTests.enabled',
      'goBench.tableTests.nameFields',
      'goBench.tableTests.showFunctionRun',
      'goBench.tableTests.showCaseRun',
      'goBench.tableTests.testingApi.enabled',
      'goBench.tableTests.testingApi.treeMode'
    ]);
  });
});
