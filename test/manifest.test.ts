/**
 * 该测试保护 VSCode manifest 的骨架契约。
 * 里程碑 0 的关键交付在 `package.json` 中声明，单测直接校验这些声明，避免后续改动误删激活事件或配置项。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  commands,
  configurationKeys,
  defaultSidebarConfig,
  defaultTableTestConfig,
  sidebarViewIds
} from '../src/constants';

type ExtensionManifest = {
  main: string;
  icon?: string;
  activationEvents: string[];
  contributes: {
    commands: Array<{ command: string; title: string; icon?: string }>;
    viewsContainers?: {
      activitybar?: Array<{ id: string; title: string; icon: string }>;
    };
    views?: Record<string, Array<{ id: string; name: string; type: string; when?: string }>>;
    menus?: {
      'view/title'?: Array<{ command: string; when?: string; group?: string }>;
      'view/item/context'?: Array<{ command: string; when?: string; group?: string }>;
    };
    configuration: {
      properties: Record<string, { default: unknown; enum?: unknown[] }>;
    };
  };
};

const manifest = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as ExtensionManifest;

describe('VSCode extension manifest', () => {
  it('points to the compiled extension entry emitted by the current TypeScript layout', () => {
    assert.equal(manifest.main, './out/src/extension.js');
  });

  it('uses the Go Bench product icon', () => {
    assert.equal(manifest.icon, 'media/icon.png');
  });

  it('activates for Go files and Go test workspaces', () => {
    assert.deepEqual(manifest.activationEvents, [
      'onLanguage:go',
      'workspaceContains:**/*_test.go',
      `onView:${sidebarViewIds.files}`,
      `onView:${sidebarViewIds.tests}`,
      `onView:${sidebarViewIds.runAndDebug}`
    ]);
  });

  it('contributes extension commands used by startup and CodeLens execution', () => {
    assert.deepEqual(manifest.contributes.commands, [
      {
        command: commands.noop,
        title: 'Go Bench: No-op'
      },
      {
        command: commands.runTest,
        title: 'Go Bench: Run Test'
      },
      {
        command: commands.debugTest,
        title: 'Go Bench: Debug Test'
      },
      {
        command: commands.refreshTestTree,
        title: 'Go Bench: Refresh Test Tree'
      },
      {
        command: commands.refreshCurrentFileTestTree,
        title: 'Go Bench: Refresh Current File Test Tree'
      },
      {
        command: commands.toggleTestTreeMode,
        title: 'Go Bench: Toggle Test Tree Mode'
      },
      {
        command: commands.toggleTestTreeModeFromGoBench,
        title: 'Go Bench Tree Active: Switch to Standard Go Tree',
        icon: '$(beaker)'
      },
      {
        command: commands.toggleTestTreeModeFromStandardGo,
        title: 'Standard Go Tree Active: Switch to Go Bench Tree',
        icon: '$(symbol-method)'
      },
      {
        command: commands.refreshSidebarFiles,
        title: 'Refresh',
        icon: '$(refresh)'
      },
      {
        command: commands.refreshSidebarTests,
        title: 'Refresh',
        icon: '$(refresh)'
      },
      {
        command: commands.revealCurrentSidebarTest,
        title: 'Reveal Current File Test',
        icon: '$(target)'
      },
      {
        command: commands.runSidebarTest,
        title: 'Run Test',
        icon: '$(run)'
      },
      {
        command: commands.debugSidebarTest,
        title: 'Debug Test',
        icon: '$(debug-alt)'
      },
      {
        command: commands.openSidebarFile,
        title: 'Open',
        icon: '$(go-to-file)'
      },
      {
        command: commands.openSidebarFileToSide,
        title: 'Open to the Side',
        icon: '$(split-horizontal)'
      },
      {
        command: commands.openSidebarFileWith,
        title: 'Open With...'
      },
      {
        command: commands.newSidebarFile,
        title: 'New File',
        icon: '$(new-file)'
      },
      {
        command: commands.newSidebarFolder,
        title: 'New Folder',
        icon: '$(new-folder)'
      },
      {
        command: commands.cutSidebarFile,
        title: 'Cut',
        icon: '$(scissors)'
      },
      {
        command: commands.copySidebarFile,
        title: 'Copy',
        icon: '$(copy)'
      },
      {
        command: commands.pasteSidebarFile,
        title: 'Paste',
        icon: '$(clippy)'
      },
      {
        command: commands.renameSidebarFile,
        title: 'Rename',
        icon: '$(edit)'
      },
      {
        command: commands.deleteSidebarFile,
        title: 'Delete',
        icon: '$(trash)'
      },
      {
        command: commands.findInSidebarFolder,
        title: 'Find in Folder...',
        icon: '$(search)'
      },
      {
        command: commands.revealSidebarFile,
        title: 'Reveal in OS',
        icon: '$(folder-opened)'
      },
      {
        command: commands.copySidebarRelativePath,
        title: 'Copy Relative Path'
      },
      {
        command: commands.copySidebarAbsolutePath,
        title: 'Copy Absolute Path'
      },
      {
        command: commands.addCurrentRunnableFile,
        title: 'Go Bench: Add Current File to Run and Debug',
        icon: '$(add)'
      },
      {
        command: commands.addRunnableFile,
        title: 'Go Bench: Add File to Run and Debug',
        icon: '$(go-to-file)'
      },
      {
        command: commands.addRunnablePackage,
        title: 'Go Bench: Add Package to Run and Debug',
        icon: '$(package)'
      },
      {
        command: commands.scanRunnableFiles,
        title: 'Go Bench: Scan Executable Go Files',
        icon: '$(search)'
      },
      {
        command: commands.createRunnableGroup,
        title: 'Go Bench: Create Runnable Group',
        icon: '$(folder)'
      },
      {
        command: commands.moveRunnableToGroup,
        title: 'Archive to Group',
        icon: '$(folder-active)'
      },
      {
        command: commands.runRunnableGroup,
        title: 'Run Group',
        icon: '$(play)'
      },
      {
        command: commands.stopRunnableGroup,
        title: 'Stop Group',
        icon: '$(debug-stop)'
      },
      {
        command: commands.restartRunnableGroup,
        title: 'Restart Group',
        icon: '$(debug-restart)'
      },
      {
        command: commands.removeRunnableGroup,
        title: 'Remove Group',
        icon: '$(trash)'
      },
      {
        command: commands.removeRunnable,
        title: 'Remove',
        icon: '$(trash)'
      },
      {
        command: commands.editRunnable,
        title: 'Edit',
        icon: '$(edit)'
      },
      {
        command: commands.runRunnable,
        title: 'Run',
        icon: '$(play)'
      },
      {
        command: commands.stopRunnable,
        title: 'Stop',
        icon: '$(debug-stop)'
      },
      {
        command: commands.restartRunnable,
        title: 'Restart',
        icon: '$(debug-restart)'
      },
      {
        command: commands.debugRunnable,
        title: 'Debug',
        icon: '$(debug-alt)'
      },
      {
        command: commands.revealRunnable,
        title: 'Open File',
        icon: '$(go-to-file)'
      },
      {
        command: commands.copyRunnablePath,
        title: 'Copy Path'
      }
    ]);
  });

  it('contributes the Go Bench Activity Bar container and milestone 12 sidebar views', () => {
    assert.deepEqual(manifest.contributes.viewsContainers?.activitybar, [
      {
        id: sidebarViewIds.container,
        title: 'Go Bench',
        icon: 'media/activitybar-icon.svg'
      }
    ]);

    assert.deepEqual(manifest.contributes.views?.[sidebarViewIds.container], [
      {
        id: sidebarViewIds.files,
        name: 'Files',
        type: 'tree',
        when: 'config.goBench.sidebar.enabled && config.goBench.sidebar.files.enabled'
      },
      {
        id: sidebarViewIds.tests,
        name: 'Tests',
        type: 'tree',
        when: 'config.goBench.sidebar.enabled && config.goBench.sidebar.tests.enabled'
      },
      {
        id: sidebarViewIds.runAndDebug,
        name: 'Run and Debug',
        type: 'tree',
        when: 'config.goBench.sidebar.enabled && config.goBench.sidebar.runnables.enabled'
      }
    ]);
  });

  it('uses a VSCode-valid Activity Bar container id', () => {
    const activityBarContainers = manifest.contributes.viewsContainers?.activitybar ?? [];
    for (const container of activityBarContainers) {
      assert.match(container.id, /^[A-Za-z0-9_-]+$/);
    }
  });

  it('keeps Go Bench sidebar views out of the built-in Explorer container', () => {
    assert.equal(manifest.contributes.views?.explorer, undefined);

    const goBenchViewIds: string[] = Object.values(sidebarViewIds);
    const contributedContainers = Object.entries(manifest.contributes.views ?? {});
    for (const [containerId, views] of contributedContainers) {
      for (const view of views) {
        if (goBenchViewIds.includes(view.id)) {
          assert.equal(containerId, sidebarViewIds.container);
        }
      }
    }
  });

  it('keeps Go Bench sidebar menu actions scoped to the Go Bench sidebar views', () => {
    const menuGroups = Object.values(manifest.contributes.menus ?? {});
    for (const menuItems of menuGroups) {
      for (const menuItem of menuItems) {
        if (!menuItem.command.startsWith('goBench.sidebar') && !menuItem.command.startsWith('goBench.runnables')) {
          continue;
        }

        assert.ok(
          menuItem.when?.includes(sidebarViewIds.files) ||
            menuItem.when?.includes(sidebarViewIds.tests) ||
            menuItem.when?.includes(sidebarViewIds.runAndDebug)
        );
        assert.equal(menuItem.when?.includes('explorer'), false);
        assert.equal(menuItem.when?.includes('workbench.explorer'), false);
      }
    }
  });

  it('contributes a Testing view title command for switching tree modes', () => {
    assert.deepEqual(manifest.contributes.menus?.['view/title'], [
      {
        command: commands.refreshSidebarFiles,
        when: `view == ${sidebarViewIds.files}`,
        group: 'navigation'
      },
      {
        command: commands.newSidebarFile,
        when: `view == ${sidebarViewIds.files}`,
        group: 'navigation@1'
      },
      {
        command: commands.newSidebarFolder,
        when: `view == ${sidebarViewIds.files}`,
        group: 'navigation@2'
      },
      {
        command: commands.refreshSidebarTests,
        when: `view == ${sidebarViewIds.tests}`,
        group: 'navigation'
      },
      {
        command: commands.revealCurrentSidebarTest,
        when: `view == ${sidebarViewIds.tests}`,
        group: 'navigation@1'
      },
      {
        command: commands.scanRunnableFiles,
        when: `view == ${sidebarViewIds.runAndDebug}`,
        group: 'navigation@0'
      },
      {
        command: commands.addCurrentRunnableFile,
        when: `view == ${sidebarViewIds.runAndDebug}`,
        group: 'navigation@1'
      },
      {
        command: commands.addRunnableFile,
        when: `view == ${sidebarViewIds.runAndDebug}`,
        group: 'navigation@2'
      },
      {
        command: commands.addRunnablePackage,
        when: `view == ${sidebarViewIds.runAndDebug}`,
        group: 'navigation@3'
      },
      {
        command: commands.createRunnableGroup,
        when: `view == ${sidebarViewIds.runAndDebug}`,
        group: 'navigation@4'
      },
      {
        command: commands.toggleTestTreeModeFromGoBench,
        when: 'view == workbench.view.testing && goBench.testTreeMode.goBench',
        group: 'navigation'
      },
      {
        command: commands.toggleTestTreeModeFromStandardGo,
        when: 'view == workbench.view.testing && goBench.testTreeMode.standardGo',
        group: 'navigation'
      }
    ]);
  });

  it('contributes Files view item context actions', () => {
    assert.deepEqual(manifest.contributes.menus?.['view/item/context'], [
      {
        command: commands.runSidebarTest,
        when: `view == ${sidebarViewIds.tests} && (viewItem == goBenchTestRunnable || viewItem == goBenchTestRunnableGroup)`,
        group: 'inline@0'
      },
      {
        command: commands.debugSidebarTest,
        when: `view == ${sidebarViewIds.tests} && (viewItem == goBenchTestRunnable || viewItem == goBenchTestRunnableGroup)`,
        group: 'inline@1'
      },
      {
        command: commands.openSidebarFile,
        when: `view == ${sidebarViewIds.files} && viewItem == goBenchFile`,
        group: 'navigation@0'
      },
      {
        command: commands.openSidebarFileToSide,
        when: `view == ${sidebarViewIds.files} && viewItem == goBenchFile`,
        group: 'navigation@1'
      },
      {
        command: commands.openSidebarFileWith,
        when: `view == ${sidebarViewIds.files} && viewItem == goBenchFile`,
        group: 'navigation@2'
      },
      {
        command: commands.newSidebarFile,
        when: `view == ${sidebarViewIds.files} && (viewItem == goBenchFolder || viewItem == goBenchWorkspaceFolder)`,
        group: '2_workspace@0'
      },
      {
        command: commands.newSidebarFolder,
        when: `view == ${sidebarViewIds.files} && (viewItem == goBenchFolder || viewItem == goBenchWorkspaceFolder)`,
        group: '2_workspace@1'
      },
      {
        command: commands.cutSidebarFile,
        when: `view == ${sidebarViewIds.files} && (viewItem == goBenchFile || viewItem == goBenchFolder)`,
        group: '3_edit@0'
      },
      {
        command: commands.copySidebarFile,
        when: `view == ${sidebarViewIds.files} && (viewItem == goBenchFile || viewItem == goBenchFolder)`,
        group: '3_edit@1'
      },
      {
        command: commands.pasteSidebarFile,
        when: `view == ${sidebarViewIds.files} && (viewItem == goBenchFolder || viewItem == goBenchWorkspaceFolder)`,
        group: '3_edit@2'
      },
      {
        command: commands.renameSidebarFile,
        when: `view == ${sidebarViewIds.files} && (viewItem == goBenchFile || viewItem == goBenchFolder)`,
        group: '3_edit@3'
      },
      {
        command: commands.deleteSidebarFile,
        when: `view == ${sidebarViewIds.files} && (viewItem == goBenchFile || viewItem == goBenchFolder)`,
        group: '3_edit@4'
      },
      {
        command: commands.findInSidebarFolder,
        when: `view == ${sidebarViewIds.files}`,
        group: '4_search@0'
      },
      {
        command: commands.revealSidebarFile,
        when: `view == ${sidebarViewIds.files}`,
        group: '5_reveal@0'
      },
      {
        command: commands.copySidebarRelativePath,
        when: `view == ${sidebarViewIds.files}`,
        group: '6_copy@0'
      },
      {
        command: commands.copySidebarAbsolutePath,
        when: `view == ${sidebarViewIds.files}`,
        group: '6_copy@1'
      },
      {
        command: commands.runRunnable,
        when: `view == ${sidebarViewIds.runAndDebug} && viewItem == goBenchRunnableStopped`,
        group: 'inline@0'
      },
      {
        command: commands.debugRunnable,
        when: `view == ${sidebarViewIds.runAndDebug} && viewItem == goBenchRunnableStopped`,
        group: 'inline@1'
      },
      {
        command: commands.stopRunnable,
        when: `view == ${sidebarViewIds.runAndDebug} && (viewItem == goBenchRunnableRunning || viewItem == goBenchRunnableDebugging)`,
        group: 'inline@2'
      },
      {
        command: commands.restartRunnable,
        when: `view == ${sidebarViewIds.runAndDebug} && (viewItem == goBenchRunnableRunning || viewItem == goBenchRunnableDebugging)`,
        group: 'inline@3'
      },
      {
        command: commands.revealRunnable,
        when: `view == ${sidebarViewIds.runAndDebug} && (viewItem == goBenchRunnableStopped || viewItem == goBenchRunnableRunning || viewItem == goBenchRunnableDebugging)`,
        group: 'inline@4'
      },
      {
        command: commands.removeRunnable,
        when: `view == ${sidebarViewIds.runAndDebug} && (viewItem == goBenchRunnableStopped || viewItem == goBenchRunnableRunning || viewItem == goBenchRunnableDebugging)`,
        group: 'inline@5'
      },
      {
        command: commands.runRunnableGroup,
        when: `view == ${sidebarViewIds.runAndDebug} && (viewItem == goBenchRunnableGroupStopped || viewItem == goBenchRunnableGroupRunning)`,
        group: 'inline@0'
      },
      {
        command: commands.stopRunnableGroup,
        when: `view == ${sidebarViewIds.runAndDebug} && viewItem == goBenchRunnableGroupRunning`,
        group: 'inline@1'
      },
      {
        command: commands.restartRunnableGroup,
        when: `view == ${sidebarViewIds.runAndDebug} && viewItem == goBenchRunnableGroupRunning`,
        group: 'inline@2'
      },
      {
        command: commands.editRunnable,
        when: `view == ${sidebarViewIds.runAndDebug} && (viewItem == goBenchRunnableStopped || viewItem == goBenchRunnableRunning || viewItem == goBenchRunnableDebugging)`,
        group: 'navigation@0'
      },
      {
        command: commands.moveRunnableToGroup,
        when: `view == ${sidebarViewIds.runAndDebug} && (viewItem == goBenchRunnableStopped || viewItem == goBenchRunnableRunning || viewItem == goBenchRunnableDebugging)`,
        group: 'navigation@1'
      },
      {
        command: commands.removeRunnable,
        when: `view == ${sidebarViewIds.runAndDebug} && (viewItem == goBenchRunnableStopped || viewItem == goBenchRunnableRunning || viewItem == goBenchRunnableDebugging)`,
        group: 'navigation@2'
      },
      {
        command: commands.copyRunnablePath,
        when: `view == ${sidebarViewIds.runAndDebug} && (viewItem == goBenchRunnableStopped || viewItem == goBenchRunnableRunning || viewItem == goBenchRunnableDebugging)`,
        group: 'navigation@3'
      },
      {
        command: commands.removeRunnableGroup,
        when: `view == ${sidebarViewIds.runAndDebug} && (viewItem == goBenchRunnableGroupStopped || viewItem == goBenchRunnableGroupRunning)`,
        group: 'navigation@0'
      },
      {
        command: commands.addRunnableFile,
        when: `view == ${sidebarViewIds.files} && viewItem == goBenchFile`,
        group: '7_runnables@0'
      },
      {
        command: commands.addRunnablePackage,
        when: `view == ${sidebarViewIds.files} && (viewItem == goBenchFolder || viewItem == goBenchWorkspaceFolder)`,
        group: '7_runnables@1'
      }
    ]);
  });

  it('contributes table test configuration defaults', () => {
    const properties = manifest.contributes.configuration.properties;

    assert.equal(properties[configurationKeys.enabled].default, defaultTableTestConfig.enabled);
    assert.deepEqual(properties[configurationKeys.nameFields].default, defaultTableTestConfig.nameFields);
    assert.equal(properties[configurationKeys.showFunctionRun].default, defaultTableTestConfig.showFunctionRun);
    assert.equal(properties[configurationKeys.showCaseRun].default, defaultTableTestConfig.showCaseRun);
    assert.equal(properties[configurationKeys.testingApiEnabled].default, defaultTableTestConfig.testingApiEnabled);
    assert.equal(properties[configurationKeys.testingApiTreeMode].default, defaultTableTestConfig.testingApiTreeMode);
    assert.deepEqual(properties[configurationKeys.testingApiTreeMode].enum, ['goBench', 'standardGo']);
  });

  it('contributes sidebar configuration defaults', () => {
    const properties = manifest.contributes.configuration.properties;

    assert.equal(properties[configurationKeys.sidebarEnabled].default, defaultSidebarConfig.enabled);
    assert.equal(properties[configurationKeys.sidebarFilesEnabled].default, defaultSidebarConfig.filesEnabled);
    assert.equal(properties[configurationKeys.sidebarTestsEnabled].default, defaultSidebarConfig.testsEnabled);
    assert.equal(properties[configurationKeys.sidebarRunnablesEnabled].default, defaultSidebarConfig.runnablesEnabled);
    assert.deepEqual(properties[configurationKeys.runnableItems].default, defaultSidebarConfig.runnableItems);
    assert.deepEqual(properties[configurationKeys.runnableGroups].default, defaultSidebarConfig.runnableGroups);
    assert.equal(
      properties[configurationKeys.runnablesDefaultRunInTerminal].default,
      defaultSidebarConfig.runnablesDefaultRunInTerminal
    );
  });
});
