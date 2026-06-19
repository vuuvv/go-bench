/**
 * Go Bench Run and Debug 侧边栏视图。
 *
 * 该模块负责 VSCode 交互层：把 workspace settings 中的 runnable 列表展示为 tree view，并注册添加、
 * 编辑、删除、运行、调试和打开目标命令。数据建模和命令构造放在 `runnablesModel`，便于单测覆盖。
 */

import { basename, extname } from 'node:path';
import * as vscode from 'vscode';
import { commands, configurationKeys } from './constants';
import type { FileExplorerNode } from './fileExplorer';
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
  type GoBenchRunnableItem,
  type GoBenchRunnableKind,
  type RunnableWorkspaceFolder
} from './runnablesModel';

type RunnableTreeNode =
  | {
      kind: 'empty';
      label: string;
    }
  | {
      kind: 'runnable';
      item: GoBenchRunnableItem;
    };

/** Run and Debug 视图的数据提供器，直接从 workspace settings 读取最新 runnable 列表。 */
export class GoBenchRunnablesProvider
  implements vscode.TreeDataProvider<RunnableTreeNode>, vscode.Disposable {
  private readonly treeDataDidChangeEmitter = new vscode.EventEmitter<RunnableTreeNode | undefined | null | void>();

  public readonly onDidChangeTreeData = this.treeDataDidChangeEmitter.event;

  public refresh(): void {
    this.treeDataDidChangeEmitter.fire();
  }

  public getTreeItem(node: RunnableTreeNode): vscode.TreeItem {
    if (node.kind === 'empty') {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('add');
      item.contextValue = 'goBenchRunnableEmpty';
      item.command = {
        command: commands.addCurrentRunnableFile,
        title: 'Add Current File',
        arguments: []
      };
      return item;
    }

    const treeItem = new vscode.TreeItem(node.item.label, vscode.TreeItemCollapsibleState.None);
    treeItem.description = node.item.kind === 'goFile' ? 'Go file' : 'Go package';
    treeItem.tooltip = `${node.item.label}\n${node.item.uri}\nworkspace: ${node.item.workspaceFolder}`;
    treeItem.contextValue = 'goBenchRunnable';
    treeItem.iconPath = new vscode.ThemeIcon(node.item.kind === 'goFile' ? 'go-to-file' : 'package');
    treeItem.command = {
      command: commands.revealRunnable,
      title: 'Open Runnable Target',
      arguments: [node.item]
    };
    return treeItem;
  }

  public getChildren(): vscode.ProviderResult<RunnableTreeNode[]> {
    const items = readRunnableItems();
    if (items.length === 0) {
      return [{ kind: 'empty', label: 'Add current file' }];
    }
    return items.map(item => ({ kind: 'runnable', item }));
  }

  public dispose(): void {
    this.treeDataDidChangeEmitter.dispose();
  }
}

/** 注册 Run and Debug 视图命令、配置监听和 runnable 操作。 */
export function registerGoBenchRunnables(options: {
  provider: GoBenchRunnablesProvider;
  output: vscode.OutputChannel;
}): vscode.Disposable {
  const configurationSubscription = vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration(configurationKeys.runnableItems)) {
      options.provider.refresh();
    }
  });

  const addCurrentFileCommand = vscode.commands.registerCommand(commands.addCurrentRunnableFile, async () => {
    const uri = vscode.window.activeTextEditor?.document.uri;
    if (!uri) {
      void vscode.window.showErrorMessage('Go Bench: open a Go file before adding a runnable.');
      return;
    }
    await addRunnableFromUri(uri, 'goFile', options);
  });
  const addFileCommand = vscode.commands.registerCommand(commands.addRunnableFile, async (node?: FileExplorerNode) => {
    if (node?.kind === 'file') {
      await addRunnableFromUri(node.uri, 'goFile', options);
      return;
    }

    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { 'Go files': ['go'] },
      title: 'Add Go file to Go Bench Run and Debug'
    });
    if (!uris?.[0]) {
      return;
    }
    await addRunnableFromUri(uris[0], 'goFile', options);
  });
  const addPackageCommand = vscode.commands.registerCommand(commands.addRunnablePackage, async (node?: FileExplorerNode) => {
    if (node && node.kind !== 'file') {
      await addRunnableFromUri(node.uri, 'goPackage', options);
      return;
    }

    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      title: 'Add Go package to Go Bench Run and Debug'
    });
    if (!uris?.[0]) {
      return;
    }
    await addRunnableFromUri(uris[0], 'goPackage', options);
  });
  const removeCommand = vscode.commands.registerCommand(commands.removeRunnable, async (itemOrNode?: GoBenchRunnableItem | RunnableTreeNode) => {
    const item = normalizeRunnableCommandArgument(itemOrNode);
    if (!item) {
      return;
    }

    const confirmed = await vscode.window.showWarningMessage(
      `Remove "${item.label}" from Go Bench Run and Debug? The file on disk will not be deleted.`,
      { modal: true },
      'Remove'
    );
    if (confirmed !== 'Remove') {
      return;
    }

    await writeRunnableItems(removeRunnable(readRunnableItems(), item.id));
    options.provider.refresh();
  });
  const editCommand = vscode.commands.registerCommand(commands.editRunnable, async (itemOrNode?: GoBenchRunnableItem | RunnableTreeNode) => {
    const item = normalizeRunnableCommandArgument(itemOrNode);
    if (!item) {
      return;
    }
    await editRunnable(item, options);
  });
  const runCommand = vscode.commands.registerCommand(commands.runRunnable, async (itemOrNode?: GoBenchRunnableItem | RunnableTreeNode) => {
    const item = normalizeRunnableCommandArgument(itemOrNode);
    if (!item) {
      return;
    }
    await runRunnable(item, options);
  });
  const debugCommand = vscode.commands.registerCommand(commands.debugRunnable, async (itemOrNode?: GoBenchRunnableItem | RunnableTreeNode) => {
    const item = normalizeRunnableCommandArgument(itemOrNode);
    if (!item) {
      return;
    }
    await debugRunnable(item, options);
  });
  const revealCommand = vscode.commands.registerCommand(commands.revealRunnable, async (itemOrNode?: GoBenchRunnableItem | RunnableTreeNode) => {
    const item = normalizeRunnableCommandArgument(itemOrNode);
    if (!item) {
      return;
    }
    await revealRunnable(item);
  });
  const copyPathCommand = vscode.commands.registerCommand(commands.copyRunnablePath, async (itemOrNode?: GoBenchRunnableItem | RunnableTreeNode) => {
    const item = normalizeRunnableCommandArgument(itemOrNode);
    const workspaceFolder = item ? findWorkspaceFolderByName(item.workspaceFolder) : undefined;
    if (!item || !workspaceFolder) {
      return;
    }
    await vscode.env.clipboard.writeText(resolvePersistedPath(item.uri, workspaceFolder));
  });

  return vscode.Disposable.from(
    configurationSubscription,
    addCurrentFileCommand,
    addFileCommand,
    addPackageCommand,
    removeCommand,
    editCommand,
    runCommand,
    debugCommand,
    revealCommand,
    copyPathCommand
  );
}

async function addRunnableFromUri(
  uri: vscode.Uri,
  kind: GoBenchRunnableKind,
  options: { provider: GoBenchRunnablesProvider; output: vscode.OutputChannel }
): Promise<void> {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  if (!workspaceFolder) {
    void vscode.window.showErrorMessage('Go Bench: runnable targets must belong to the current workspace.');
    return;
  }
  if (kind === 'goFile' && extname(uri.fsPath) !== '.go') {
    void vscode.window.showErrorMessage('Go Bench: choose a Go file for this runnable.');
    return;
  }
  if (kind === 'goFile' && !(await confirmRunnableGoFile(uri))) {
    return;
  }

  const workspace = toRunnableWorkspaceFolder(workspaceFolder);
  const input = { kind, path: uri.fsPath, workspaceFolder: workspace };
  const candidate = createRunnableItem(input);
  const currentItems = readRunnableItems();
  if (currentItems.some(item => item.id === candidate.id)) {
    const confirmed = await vscode.window.showWarningMessage(
      `"${candidate.label}" already exists in Go Bench Run and Debug. Update it?`,
      { modal: true },
      'Update'
    );
    if (confirmed !== 'Update') {
      return;
    }
  }

  const label = await vscode.window.showInputBox({
    prompt: 'Runnable label',
    value: candidate.label,
    validateInput: value => value.trim() === '' ? 'Enter a label.' : undefined
  });
  if (label === undefined) {
    return;
  }

  const result = addOrUpdateRunnable(currentItems, {
    ...input,
    label: label.trim() || candidate.label
  });
  await writeRunnableItems(result.items);
  options.provider.refresh();
  void vscode.window.showInformationMessage(
    result.action === 'added'
      ? `Go Bench: added "${result.item.label}" to Run and Debug.`
      : `Go Bench: updated "${result.item.label}" in Run and Debug.`
  );
}

async function confirmRunnableGoFile(uri: vscode.Uri): Promise<boolean> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const text = Buffer.from(bytes).toString('utf8');
    if (/^\s*package\s+main\b/m.test(text)) {
      return true;
    }
  } catch {
    return true;
  }

  const confirmed = await vscode.window.showWarningMessage(
    `"${basename(uri.fsPath)}" is not package main. Running it may fail.`,
    { modal: true },
    'Add Anyway'
  );
  return confirmed === 'Add Anyway';
}

async function editRunnable(
  item: GoBenchRunnableItem,
  options: { provider: GoBenchRunnablesProvider; output: vscode.OutputChannel }
): Promise<void> {
  const label = await vscode.window.showInputBox({
    prompt: 'Runnable label',
    value: item.label,
    validateInput: value => value.trim() === '' ? 'Enter a label.' : undefined
  });
  if (label === undefined) {
    return;
  }

  const args = await vscode.window.showInputBox({
    prompt: 'Run arguments',
    value: item.args.join(' '),
    placeHolder: '--flag value'
  });
  if (args === undefined) {
    return;
  }

  const cwd = await vscode.window.showInputBox({
    prompt: 'Working directory',
    value: item.cwd,
    placeHolder: item.kind === 'goFile' ? 'cmd/api' : '.'
  });
  if (cwd === undefined) {
    return;
  }

  const env = await vscode.window.showInputBox({
    prompt: 'Environment variables, one KEY=value per line',
    value: Object.entries(item.env ?? {}).map(([key, value]) => `${key}=${value}`).join('\n')
  });
  if (env === undefined) {
    return;
  }

  const updated = editRunnableItem(item, {
    label: label.trim() || item.label,
    args: parseRunnableArgs(args),
    cwd: cwd.trim() || item.cwd,
    env: parseRunnableEnv(env)
  });
  await writeRunnableItems(readRunnableItems().map(current => current.id === item.id ? updated : current));
  options.provider.refresh();
}

async function runRunnable(
  item: GoBenchRunnableItem,
  options: { provider: GoBenchRunnablesProvider; output: vscode.OutputChannel }
): Promise<void> {
  const workspaceFolder = findWorkspaceFolderByName(item.workspaceFolder);
  if (!workspaceFolder) {
    void vscode.window.showErrorMessage(`Go Bench: workspace "${item.workspaceFolder}" is not open.`);
    return;
  }

  const cwd = resolvePersistedPath(item.cwd, workspaceFolder);
  if (!(await uriExists(vscode.Uri.file(resolvePersistedPath(item.uri, workspaceFolder))))) {
    void vscode.window.showErrorMessage('Go Bench: runnable target no longer exists. Remove it or add it again.');
    return;
  }

  const command = buildGoRunCommand(item, workspaceFolder);
  options.output.appendLine('');
  options.output.appendLine(`Running runnable ${item.label}`);
  options.output.appendLine(`$ ${command}`);

  const terminal = vscode.window.createTerminal({
    name: `Go Bench: ${item.label}`,
    cwd,
    env: item.env
  });
  terminal.show();
  terminal.sendText(command);
}

async function debugRunnable(
  item: GoBenchRunnableItem,
  options: { provider: GoBenchRunnablesProvider; output: vscode.OutputChannel }
): Promise<void> {
  const workspaceFolder = findWorkspaceFolderByName(item.workspaceFolder);
  if (!workspaceFolder) {
    void vscode.window.showErrorMessage(`Go Bench: workspace "${item.workspaceFolder}" is not open.`);
    return;
  }
  if (!(await uriExists(vscode.Uri.file(resolvePersistedPath(item.uri, workspaceFolder))))) {
    void vscode.window.showErrorMessage('Go Bench: runnable target no longer exists. Remove it or add it again.');
    return;
  }

  const configuration = buildRunnableDebugConfiguration(item, workspaceFolder);
  options.output.appendLine('');
  options.output.appendLine(`Debugging runnable ${item.label}`);
  options.output.appendLine(`Go Bench runnable debug configuration: ${JSON.stringify(configuration)}`);

  try {
    const vscodeWorkspaceFolder = vscode.workspace.workspaceFolders?.find(folder => folder.name === item.workspaceFolder);
    const started = await vscode.debug.startDebugging(vscodeWorkspaceFolder, configuration);
    if (!started) {
      void vscode.window.showErrorMessage('Go Bench: failed to start runnable debugging. Check the Go extension is installed.');
    }
  } catch (error) {
    options.output.appendLine(`Go Bench runnable debug failed: ${String(error)}`);
    void vscode.window.showErrorMessage(`Go Bench: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function revealRunnable(item: GoBenchRunnableItem): Promise<void> {
  const workspaceFolder = findWorkspaceFolderByName(item.workspaceFolder);
  if (!workspaceFolder) {
    void vscode.window.showErrorMessage(`Go Bench: workspace "${item.workspaceFolder}" is not open.`);
    return;
  }

  const uri = vscode.Uri.file(resolvePersistedPath(item.uri, workspaceFolder));
  if (item.kind === 'goFile') {
    await vscode.window.showTextDocument(uri);
    return;
  }
  await vscode.commands.executeCommand('revealFileInOS', uri);
}

function normalizeRunnableCommandArgument(arg: GoBenchRunnableItem | RunnableTreeNode | undefined): GoBenchRunnableItem | undefined {
  if (!arg) {
    return undefined;
  }
  if ('id' in arg) {
    return arg;
  }
  if (arg.kind === 'runnable') {
    return arg.item;
  }
  return undefined;
}

function readRunnableItems(): GoBenchRunnableItem[] {
  return vscode.workspace.getConfiguration().get<GoBenchRunnableItem[]>(configurationKeys.runnableItems, []);
}

async function writeRunnableItems(items: GoBenchRunnableItem[]): Promise<void> {
  await vscode.workspace.getConfiguration().update(configurationKeys.runnableItems, items, vscode.ConfigurationTarget.Workspace);
}

function findWorkspaceFolderByName(name: string): RunnableWorkspaceFolder | undefined {
  const workspaceFolder = vscode.workspace.workspaceFolders?.find(folder => folder.name === name);
  return workspaceFolder ? toRunnableWorkspaceFolder(workspaceFolder) : undefined;
}

function toRunnableWorkspaceFolder(workspaceFolder: vscode.WorkspaceFolder): RunnableWorkspaceFolder {
  return {
    name: workspaceFolder.name,
    path: workspaceFolder.uri.fsPath
  };
}

async function uriExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}
