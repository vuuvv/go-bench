/**
 * 里程碑 0 的基础测试聚焦在稳定契约：命令 ID、output channel 和默认配置。
 * 这些值会被 `package.json`、后续 CodeLens provider 和 runner 共同依赖，先用轻量测试保护漂移风险。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  commands,
  configurationKeys,
  defaultSidebarConfig,
  contextKeys,
  defaultTableTestConfig,
  outputChannelName,
  sidebarViewIds,
  standardGoTestExplorerConfigurationKey
} from '../src/constants';

describe('extension skeleton constants', () => {
  it('uses the contributed no-op command id', () => {
    assert.equal(commands.noop, 'goBench.noop');
    assert.equal(commands.runTest, 'goBench.runTest');
    assert.equal(commands.debugTest, 'goBench.debugTest');
    assert.equal(commands.refreshTestTree, 'goBench.refreshTestTree');
    assert.equal(commands.refreshCurrentFileTestTree, 'goBench.refreshCurrentFileTestTree');
    assert.equal(commands.toggleTestTreeMode, 'goBench.toggleTestTreeMode');
    assert.equal(commands.toggleTestTreeModeFromGoBench, 'goBench.toggleTestTreeModeFromGoBench');
    assert.equal(commands.toggleTestTreeModeFromStandardGo, 'goBench.toggleTestTreeModeFromStandardGo');
    assert.equal(commands.refreshSidebarFiles, 'goBench.sidebar.refreshFiles');
    assert.equal(commands.refreshSidebarTests, 'goBench.sidebar.refreshTests');
    assert.equal(commands.openSidebarFile, 'goBench.sidebar.files.open');
    assert.equal(commands.newSidebarFile, 'goBench.sidebar.files.newFile');
    assert.equal(commands.newSidebarFolder, 'goBench.sidebar.files.newFolder');
    assert.equal(commands.renameSidebarFile, 'goBench.sidebar.files.rename');
    assert.equal(commands.deleteSidebarFile, 'goBench.sidebar.files.delete');
    assert.equal(commands.revealSidebarFile, 'goBench.sidebar.files.reveal');
    assert.equal(commands.copySidebarRelativePath, 'goBench.sidebar.files.copyRelativePath');
    assert.equal(commands.copySidebarAbsolutePath, 'goBench.sidebar.files.copyAbsolutePath');
  });

  it('defines stable Go Bench sidebar view ids', () => {
    assert.deepEqual(sidebarViewIds, {
      container: 'goBench.sidebar',
      files: 'goBench.sidebar.files',
      tests: 'goBench.sidebar.tests',
      runAndDebug: 'goBench.sidebar.runAndDebug'
    });
  });

  it('defines Test Explorer tree mode context keys', () => {
    assert.deepEqual(contextKeys, {
      testTreeModeGoBench: 'goBench.testTreeMode.goBench',
      testTreeModeStandardGo: 'goBench.testTreeMode.standardGo'
    });
  });

  it('uses a stable output channel name', () => {
    assert.equal(outputChannelName, 'Go Bench');
  });

  it('tracks the official Go Test Explorer setting used for tree visibility', () => {
    assert.equal(standardGoTestExplorerConfigurationKey, 'go.testExplorer.enable');
  });

  it('keeps table test defaults aligned with milestone 0 requirements', () => {
    assert.deepEqual(defaultTableTestConfig, {
      enabled: true,
      nameFields: ['name', 'desc', 'caseName', 'title'],
      showFunctionRun: true,
      showCaseRun: true,
      testingApiEnabled: true,
      testingApiTreeMode: 'goBench'
    });
  });

  it('keeps sidebar defaults aligned with milestone 12 requirements', () => {
    assert.deepEqual(defaultSidebarConfig, {
      enabled: true,
      filesEnabled: true,
      testsEnabled: true,
      runnablesEnabled: true
    });
  });

  it('defines stable extension configuration keys', () => {
    assert.deepEqual(Object.values(configurationKeys), [
      'goBench.tableTests.enabled',
      'goBench.tableTests.nameFields',
      'goBench.tableTests.showFunctionRun',
      'goBench.tableTests.showCaseRun',
      'goBench.tableTests.testingApi.enabled',
      'goBench.tableTests.testingApi.treeMode',
      'goBench.sidebar.enabled',
      'goBench.sidebar.files.enabled',
      'goBench.sidebar.tests.enabled',
      'goBench.sidebar.runnables.enabled'
    ]);
  });
});
