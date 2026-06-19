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
        title: 'Go Bench: Refresh Files',
        icon: '$(refresh)'
      },
      {
        command: commands.refreshSidebarTests,
        title: 'Go Bench: Refresh Tests',
        icon: '$(refresh)'
      },
      {
        command: commands.openSidebarFile,
        title: 'Go Bench: Open File',
        icon: '$(go-to-file)'
      },
      {
        command: commands.newSidebarFile,
        title: 'Go Bench: New File',
        icon: '$(new-file)'
      },
      {
        command: commands.newSidebarFolder,
        title: 'Go Bench: New Folder',
        icon: '$(new-folder)'
      },
      {
        command: commands.renameSidebarFile,
        title: 'Go Bench: Rename',
        icon: '$(edit)'
      },
      {
        command: commands.deleteSidebarFile,
        title: 'Go Bench: Delete',
        icon: '$(trash)'
      },
      {
        command: commands.revealSidebarFile,
        title: 'Go Bench: Reveal in OS',
        icon: '$(folder-opened)'
      },
      {
        command: commands.copySidebarRelativePath,
        title: 'Go Bench: Copy Relative Path'
      },
      {
        command: commands.copySidebarAbsolutePath,
        title: 'Go Bench: Copy Absolute Path'
      }
    ]);
  });

  it('contributes the Go Bench Activity Bar container and milestone 12 sidebar views', () => {
    assert.deepEqual(manifest.contributes.viewsContainers?.activitybar, [
      {
        id: sidebarViewIds.container,
        title: 'Go Bench',
        icon: 'media/icon.png'
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
        if (!menuItem.command.startsWith('goBench.sidebar')) {
          continue;
        }

        assert.ok(menuItem.when?.includes(sidebarViewIds.container));
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
        command: commands.openSidebarFile,
        when: `view == ${sidebarViewIds.files} && viewItem == goBenchFile`,
        group: 'inline@0'
      },
      {
        command: commands.newSidebarFile,
        when: `view == ${sidebarViewIds.files} && (viewItem == goBenchFolder || viewItem == goBenchWorkspaceFolder)`,
        group: 'inline@1'
      },
      {
        command: commands.newSidebarFolder,
        when: `view == ${sidebarViewIds.files} && (viewItem == goBenchFolder || viewItem == goBenchWorkspaceFolder)`,
        group: 'inline@2'
      },
      {
        command: commands.renameSidebarFile,
        when: `view == ${sidebarViewIds.files} && (viewItem == goBenchFile || viewItem == goBenchFolder)`,
        group: 'inline@3'
      },
      {
        command: commands.deleteSidebarFile,
        when: `view == ${sidebarViewIds.files} && (viewItem == goBenchFile || viewItem == goBenchFolder)`,
        group: 'inline@4'
      },
      {
        command: commands.revealSidebarFile,
        when: `view == ${sidebarViewIds.files}`,
        group: 'navigation'
      },
      {
        command: commands.copySidebarRelativePath,
        when: `view == ${sidebarViewIds.files}`,
        group: 'navigation@1'
      },
      {
        command: commands.copySidebarAbsolutePath,
        when: `view == ${sidebarViewIds.files}`,
        group: 'navigation@2'
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
  });
});
