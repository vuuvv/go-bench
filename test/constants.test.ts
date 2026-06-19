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
    assert.equal(commands.revealCurrentSidebarTest, 'goBench.sidebar.tests.revealCurrentFile');
    assert.equal(commands.runSidebarTest, 'goBench.sidebar.tests.run');
    assert.equal(commands.debugSidebarTest, 'goBench.sidebar.tests.debug');
    assert.equal(commands.openSidebarFile, 'goBench.sidebar.files.open');
    assert.equal(commands.openSidebarFileToSide, 'goBench.sidebar.files.openToSide');
    assert.equal(commands.openSidebarFileWith, 'goBench.sidebar.files.openWith');
    assert.equal(commands.newSidebarFile, 'goBench.sidebar.files.newFile');
    assert.equal(commands.newSidebarFolder, 'goBench.sidebar.files.newFolder');
    assert.equal(commands.cutSidebarFile, 'goBench.sidebar.files.cut');
    assert.equal(commands.copySidebarFile, 'goBench.sidebar.files.copy');
    assert.equal(commands.pasteSidebarFile, 'goBench.sidebar.files.paste');
    assert.equal(commands.renameSidebarFile, 'goBench.sidebar.files.rename');
    assert.equal(commands.deleteSidebarFile, 'goBench.sidebar.files.delete');
    assert.equal(commands.findInSidebarFolder, 'goBench.sidebar.files.findInFolder');
    assert.equal(commands.revealSidebarFile, 'goBench.sidebar.files.reveal');
    assert.equal(commands.copySidebarRelativePath, 'goBench.sidebar.files.copyRelativePath');
    assert.equal(commands.copySidebarAbsolutePath, 'goBench.sidebar.files.copyAbsolutePath');
    assert.equal(commands.addCurrentRunnableFile, 'goBench.runnables.addCurrentFile');
    assert.equal(commands.addRunnableFile, 'goBench.runnables.addFile');
    assert.equal(commands.addRunnablePackage, 'goBench.runnables.addPackage');
    assert.equal(commands.scanRunnableFiles, 'goBench.runnables.scanFiles');
    assert.equal(commands.createRunnableGroup, 'goBench.runnables.createGroup');
    assert.equal(commands.moveRunnableToGroup, 'goBench.runnables.moveToGroup');
    assert.equal(commands.runRunnableGroup, 'goBench.runnables.runGroup');
    assert.equal(commands.stopRunnableGroup, 'goBench.runnables.stopGroup');
    assert.equal(commands.restartRunnableGroup, 'goBench.runnables.restartGroup');
    assert.equal(commands.removeRunnableGroup, 'goBench.runnables.removeGroup');
    assert.equal(commands.removeRunnable, 'goBench.runnables.remove');
    assert.equal(commands.editRunnable, 'goBench.runnables.edit');
    assert.equal(commands.runRunnable, 'goBench.runnables.run');
    assert.equal(commands.stopRunnable, 'goBench.runnables.stop');
    assert.equal(commands.restartRunnable, 'goBench.runnables.restart');
    assert.equal(commands.debugRunnable, 'goBench.runnables.debug');
    assert.equal(commands.revealRunnable, 'goBench.runnables.reveal');
    assert.equal(commands.copyRunnablePath, 'goBench.runnables.copyPath');
  });

  it('defines stable Go Bench sidebar view ids', () => {
    assert.deepEqual(sidebarViewIds, {
      container: 'go-bench-sidebar',
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
      runnablesEnabled: true,
      runnableItems: [],
      runnableGroups: [],
      runnablesDefaultRunInTerminal: true
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
      'goBench.sidebar.runnables.enabled',
      'goBench.runnables.items',
      'goBench.runnables.groups',
      'goBench.runnables.defaultRunInTerminal'
    ]);
  });
});
