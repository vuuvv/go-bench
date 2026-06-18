/**
 * 该测试保护 VSCode manifest 的骨架契约。
 * 里程碑 0 的关键交付在 `package.json` 中声明，单测直接校验这些声明，避免后续改动误删激活事件或配置项。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { commands, configurationKeys, defaultTableTestConfig } from '../src/constants';

type ExtensionManifest = {
  main: string;
  activationEvents: string[];
  contributes: {
    commands: Array<{ command: string; title: string }>;
    menus?: {
      'view/title'?: Array<{ command: string; when?: string; group?: string }>;
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

  it('activates for Go files and Go test workspaces', () => {
    assert.deepEqual(manifest.activationEvents, ['onLanguage:go', 'workspaceContains:**/*_test.go']);
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
      }
    ]);
  });

  it('contributes a Testing view title command for switching tree modes', () => {
    assert.deepEqual(manifest.contributes.menus?.['view/title'], [
      {
        command: commands.toggleTestTreeMode,
        when: 'view == workbench.view.testing',
        group: 'navigation'
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
});
