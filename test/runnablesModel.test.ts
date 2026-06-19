/**
 * Go Bench runnable 模型测试。
 *
 * 这些测试保护里程碑 15 的核心契约：workspace 内路径相对持久化、重复添加更新已有项、删除不影响
 * 目标文件模型，以及 run/debug 构造和 Go package / Go file 行为一致。
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  addOrUpdateRunnable,
  buildGoRunCommand,
  buildRunnableDebugConfiguration,
  createRunnableItem,
  editRunnableItem,
  parseRunnableArgs,
  parseRunnableEnv,
  removeRunnable,
  resolvePersistedPath,
  toPersistedPath,
  type GoBenchRunnableItem,
  type RunnableWorkspaceFolder
} from '../src/runnablesModel';

const workspace: RunnableWorkspaceFolder = {
  name: 'repo',
  path: join('/', 'workspace', 'repo')
};

describe('Go Bench runnable model', () => {
  it('persists workspace paths as relative paths and restores absolute paths', () => {
    const file = join(workspace.path, 'cmd', 'api', 'main.go');

    assert.equal(toPersistedPath(file, workspace), 'cmd/api/main.go');
    assert.equal(resolvePersistedPath('cmd/api/main.go', workspace), file);
  });

  it('creates Go file runnable items with stable ids and relative cwd', () => {
    const item = createRunnableItem({
      kind: 'goFile',
      path: join(workspace.path, 'cmd', 'api', 'main.go'),
      workspaceFolder: workspace,
      now: '2026-06-19T00:00:00.000Z'
    });

    assert.deepEqual(item, {
      id: 'repo:goFile:cmd/api/main.go',
      label: 'main.go',
      uri: 'cmd/api/main.go',
      workspaceFolder: 'repo',
      kind: 'goFile',
      cwd: 'cmd/api',
      args: [],
      env: undefined,
      createdAt: '2026-06-19T00:00:00.000Z',
      updatedAt: '2026-06-19T00:00:00.000Z'
    });
  });

  it('updates existing runnable targets instead of duplicating them', () => {
    const first = addOrUpdateRunnable([], {
      kind: 'goFile',
      path: join(workspace.path, 'cmd', 'api', 'main.go'),
      workspaceFolder: workspace,
      label: 'api',
      now: '2026-06-19T00:00:00.000Z'
    });
    const second = addOrUpdateRunnable(first.items, {
      kind: 'goFile',
      path: join(workspace.path, 'cmd', 'api', 'main.go'),
      workspaceFolder: workspace,
      label: 'api server',
      args: ['--port', '8080'],
      now: '2026-06-19T01:00:00.000Z'
    });

    assert.equal(first.action, 'added');
    assert.equal(second.action, 'updated');
    assert.equal(second.items.length, 1);
    assert.equal(second.item.label, 'api server');
    assert.deepEqual(second.item.args, ['--port', '8080']);
    assert.equal(second.item.createdAt, '2026-06-19T00:00:00.000Z');
    assert.equal(second.item.updatedAt, '2026-06-19T01:00:00.000Z');
  });

  it('removes and edits runnable items without changing their target id', () => {
    const item = createRunnableItem({
      kind: 'goPackage',
      path: join(workspace.path, 'cmd', 'worker'),
      workspaceFolder: workspace,
      now: '2026-06-19T00:00:00.000Z'
    });
    const edited = editRunnableItem(
      item,
      { label: 'worker', args: ['--once'], env: { GO_ENV: 'test' } },
      '2026-06-19T01:00:00.000Z'
    );

    assert.equal(edited.id, item.id);
    assert.equal(edited.label, 'worker');
    assert.deepEqual(edited.args, ['--once']);
    assert.deepEqual(edited.env, { GO_ENV: 'test' });
    assert.deepEqual(removeRunnable([edited], item.id), []);
  });

  it('builds go run commands for files and packages', () => {
    const fileItem = createRunnableItem({
      kind: 'goFile',
      path: join(workspace.path, 'cmd', 'api', 'main.go'),
      workspaceFolder: workspace,
      args: ['--name', 'demo app']
    });
    const packageItem = createRunnableItem({
      kind: 'goPackage',
      path: join(workspace.path, 'cmd', 'worker'),
      workspaceFolder: workspace,
      args: ['--once']
    });

    assert.equal(
      buildGoRunCommand(fileItem, workspace),
      "go run /workspace/repo/cmd/api/main.go --name 'demo app'"
    );
    assert.equal(buildGoRunCommand(packageItem, workspace), 'go run . --once');
  });

  it('builds Go debug configurations for runnable targets', () => {
    const item: GoBenchRunnableItem = {
      id: 'repo:goPackage:cmd/worker',
      label: 'worker',
      uri: 'cmd/worker',
      workspaceFolder: 'repo',
      kind: 'goPackage',
      cwd: 'cmd/worker',
      args: ['--once'],
      env: { GO_ENV: 'test' },
      createdAt: '2026-06-19T00:00:00.000Z',
      updatedAt: '2026-06-19T00:00:00.000Z'
    };

    assert.deepEqual(buildRunnableDebugConfiguration(item, workspace), {
      name: 'Debug worker',
      type: 'go',
      request: 'launch',
      mode: 'debug',
      program: join(workspace.path, 'cmd', 'worker'),
      cwd: join(workspace.path, 'cmd', 'worker'),
      args: ['--once'],
      env: { GO_ENV: 'test' }
    });
  });

  it('parses quick input args and env fields', () => {
    assert.deepEqual(parseRunnableArgs(' --port  8080   --verbose '), ['--port', '8080', '--verbose']);
    assert.deepEqual(parseRunnableEnv('GO_ENV=test\nPORT=8080\ninvalid'), {
      GO_ENV: 'test',
      PORT: '8080'
    });
    assert.equal(parseRunnableEnv(''), undefined);
  });
});
