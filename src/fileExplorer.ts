/**
 * Go Bench Files 侧边栏视图。
 *
 * 第一阶段实现和 VSCode Explorer 接近的核心工作流：隐藏 workspace 根、懒加载目录、打开文件、
 * 新建、重命名、删除、复制路径、在系统文件管理器显示，并通过文件系统 watcher 自动刷新。
 */

import * as vscode from 'vscode';
import { basename } from 'node:path';
import { commands } from './constants';
import {
  isSafeRelativePathInput,
  isSafeSingleNameInput,
  sortFileExplorerEntries,
  splitRelativePathInput
} from './fileExplorerModel';

type FileExplorerNodeKind = 'workspaceFolder' | 'directory' | 'file';

export type FileExplorerNode = {
  kind: FileExplorerNodeKind;
  uri: vscode.Uri;
  label: string;
  workspaceFolder: vscode.WorkspaceFolder;
};

export class GoBenchFileExplorerProvider
  implements vscode.TreeDataProvider<FileExplorerNode>, vscode.Disposable {
  private readonly treeDataDidChangeEmitter = new vscode.EventEmitter<FileExplorerNode | undefined | null | void>();

  public readonly onDidChangeTreeData = this.treeDataDidChangeEmitter.event;

  public refresh(): void {
    this.treeDataDidChangeEmitter.fire();
  }

  public getTreeItem(node: FileExplorerNode): vscode.TreeItem {
    const collapsibleState =
      node.kind === 'file' ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Collapsed;
    const item = new vscode.TreeItem(node.uri, collapsibleState);
    item.label = node.label;
    item.resourceUri = node.uri;
    item.contextValue = node.kind === 'file' ? 'goBenchFile' : 'goBenchFolder';
    if (node.kind === 'workspaceFolder') {
      item.contextValue = 'goBenchWorkspaceFolder';
    }
    item.tooltip = node.uri.fsPath;

    if (node.kind === 'file') {
      item.command = {
        command: commands.openSidebarFile,
        title: 'Open File',
        arguments: [node]
      };
    }

    return item;
  }

  public async getChildren(node?: FileExplorerNode): Promise<FileExplorerNode[]> {
    if (!node) {
      const workspaceChildren = await Promise.all(
        (vscode.workspace.workspaceFolders ?? []).map(workspaceFolder =>
          this.readDirectoryChildren(workspaceFolder.uri, workspaceFolder)
        )
      );
      return sortFileExplorerNodes(workspaceChildren.flat());
    }

    if (node.kind === 'file') {
      return [];
    }

    return await this.readDirectoryChildren(node.uri, node.workspaceFolder);
  }

  private async readDirectoryChildren(
    uri: vscode.Uri,
    workspaceFolder: vscode.WorkspaceFolder
  ): Promise<FileExplorerNode[]> {
    const entries = await vscode.workspace.fs.readDirectory(uri);
    return sortFileExplorerEntries(
      entries.map(([name, type]) => ({
        name,
        isDirectory: (type & vscode.FileType.Directory) !== 0
      }))
    ).map(entry => ({
      kind: entry.isDirectory ? 'directory' : 'file',
      uri: vscode.Uri.joinPath(uri, entry.name),
      label: entry.name,
      workspaceFolder
    }));
  }

  public dispose(): void {
    this.treeDataDidChangeEmitter.dispose();
  }
}

function sortFileExplorerNodes(nodes: FileExplorerNode[]): FileExplorerNode[] {
  return [...nodes].sort((left, right) => {
    if (left.kind !== right.kind) {
      if (left.kind !== 'file') {
        return -1;
      }
      if (right.kind !== 'file') {
        return 1;
      }
    }

    const nameComparison = left.label.localeCompare(right.label, undefined, {
      sensitivity: 'base',
      numeric: true
    });
    if (nameComparison !== 0) {
      return nameComparison;
    }

    return left.workspaceFolder.name.localeCompare(right.workspaceFolder.name, undefined, {
      sensitivity: 'base',
      numeric: true
    });
  });
}

export function registerGoBenchFileExplorer(options: {
  provider: GoBenchFileExplorerProvider;
  output: vscode.OutputChannel;
}): vscode.Disposable {
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let fileClipboard: { node: FileExplorerNode; operation: 'copy' | 'cut' } | undefined;

  const scheduleRefresh = (): void => {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      options.provider.refresh();
    }, 150);
  };

  const watcher = vscode.workspace.createFileSystemWatcher('**/*');
  const workspaceFoldersSubscription = vscode.workspace.onDidChangeWorkspaceFolders(() => options.provider.refresh());

  const refreshFilesCommand = vscode.commands.registerCommand(commands.refreshSidebarFiles, () => {
    options.provider.refresh();
    options.output.appendLine('Go Bench Files: refreshed workspace file tree.');
  });
  const openFileCommand = vscode.commands.registerCommand(commands.openSidebarFile, async (node?: FileExplorerNode) => {
    const target = node ?? await pickCurrentEditorNode();
    if (!target || target.kind === 'directory' || target.kind === 'workspaceFolder') {
      return;
    }
    await vscode.window.showTextDocument(target.uri);
  });
  const openFileToSideCommand = vscode.commands.registerCommand(
    commands.openSidebarFileToSide,
    async (node?: FileExplorerNode) => {
      const target = node ?? await pickCurrentEditorNode();
      if (!target || target.kind === 'directory' || target.kind === 'workspaceFolder') {
        return;
      }
      await vscode.window.showTextDocument(target.uri, {
        viewColumn: vscode.ViewColumn.Beside,
        preview: false
      });
    }
  );
  const openFileWithCommand = vscode.commands.registerCommand(commands.openSidebarFileWith, async (node?: FileExplorerNode) => {
    const target = node ?? await pickCurrentEditorNode();
    if (!target || target.kind === 'directory' || target.kind === 'workspaceFolder') {
      return;
    }
    await vscode.commands.executeCommand('vscode.openWith', target.uri);
  });
  const newFileCommand = vscode.commands.registerCommand(commands.newSidebarFile, async (node?: FileExplorerNode) => {
    await createChild(node, 'file', options);
  });
  const newFolderCommand = vscode.commands.registerCommand(commands.newSidebarFolder, async (node?: FileExplorerNode) => {
    await createChild(node, 'folder', options);
  });
  const cutCommand = vscode.commands.registerCommand(commands.cutSidebarFile, (node?: FileExplorerNode) => {
    if (node && node.kind !== 'workspaceFolder') {
      fileClipboard = { node, operation: 'cut' };
    }
  });
  const copyCommand = vscode.commands.registerCommand(commands.copySidebarFile, (node?: FileExplorerNode) => {
    if (node && node.kind !== 'workspaceFolder') {
      fileClipboard = { node, operation: 'copy' };
    }
  });
  const pasteCommand = vscode.commands.registerCommand(commands.pasteSidebarFile, async (node?: FileExplorerNode) => {
    if (!fileClipboard) {
      return;
    }

    const parent = await resolveDirectoryNode(node);
    if (!parent) {
      return;
    }

    await pasteFileNode(fileClipboard, parent, options);
    if (fileClipboard.operation === 'cut') {
      fileClipboard = undefined;
    }
  });
  const renameCommand = vscode.commands.registerCommand(commands.renameSidebarFile, async (node?: FileExplorerNode) => {
    await renameNode(node, options);
  });
  const deleteCommand = vscode.commands.registerCommand(commands.deleteSidebarFile, async (node?: FileExplorerNode) => {
    await deleteNode(node, options);
  });
  const revealCommand = vscode.commands.registerCommand(commands.revealSidebarFile, async (node?: FileExplorerNode) => {
    if (node) {
      await vscode.commands.executeCommand('revealFileInOS', node.uri);
    }
  });
  const copyRelativePathCommand = vscode.commands.registerCommand(
    commands.copySidebarRelativePath,
    async (node?: FileExplorerNode) => {
      if (!node) {
        return;
      }
      await vscode.env.clipboard.writeText(vscode.workspace.asRelativePath(node.uri, false));
    }
  );
  const copyAbsolutePathCommand = vscode.commands.registerCommand(
    commands.copySidebarAbsolutePath,
    async (node?: FileExplorerNode) => {
      if (!node) {
        return;
      }
      await vscode.env.clipboard.writeText(node.uri.fsPath);
    }
  );
  const findInFolderCommand = vscode.commands.registerCommand(commands.findInSidebarFolder, async (node?: FileExplorerNode) => {
    const target = node ?? await resolveDirectoryNode();
    if (!target) {
      return;
    }

    const relativePath = vscode.workspace.asRelativePath(target.uri, false);
    await vscode.commands.executeCommand('workbench.action.findInFiles', {
      filesToInclude: target.kind === 'file' ? relativePath : `${relativePath}/**`
    });
  });

  const fileChangeSubscriptions = [
    watcher.onDidCreate(scheduleRefresh),
    watcher.onDidDelete(scheduleRefresh),
    watcher.onDidChange(scheduleRefresh)
  ];

  return vscode.Disposable.from(
    watcher,
    workspaceFoldersSubscription,
    refreshFilesCommand,
    openFileCommand,
    openFileToSideCommand,
    openFileWithCommand,
    newFileCommand,
    newFolderCommand,
    cutCommand,
    copyCommand,
    pasteCommand,
    renameCommand,
    deleteCommand,
    revealCommand,
    copyRelativePathCommand,
    copyAbsolutePathCommand,
    findInFolderCommand,
    ...fileChangeSubscriptions,
    new vscode.Disposable(() => {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
      }
    })
  );
}

async function pasteFileNode(
  source: { node: FileExplorerNode; operation: 'copy' | 'cut' },
  parent: FileExplorerNode,
  options: { provider: GoBenchFileExplorerProvider; output: vscode.OutputChannel }
): Promise<void> {
  const target = vscode.Uri.joinPath(parent.uri, basename(source.node.uri.fsPath));
  if (source.node.uri.toString() === target.toString()) {
    return;
  }

  try {
    if (await uriExists(target)) {
      void vscode.window.showErrorMessage(`Go Bench: "${basename(target.fsPath)}" already exists.`);
      return;
    }

    if (source.operation === 'cut') {
      await vscode.workspace.fs.rename(source.node.uri, target, { overwrite: false });
    } else {
      await copyUriRecursively(source.node.uri, target);
    }
    options.provider.refresh();
  } catch (error) {
    options.output.appendLine(`Go Bench Files: failed to paste ${source.node.uri.fsPath}: ${String(error)}`);
    void vscode.window.showErrorMessage('Go Bench: failed to paste file or folder.');
  }
}

async function copyUriRecursively(source: vscode.Uri, target: vscode.Uri): Promise<void> {
  const stat = await vscode.workspace.fs.stat(source);
  if ((stat.type & vscode.FileType.Directory) !== 0) {
    await vscode.workspace.fs.createDirectory(target);
    const entries = await vscode.workspace.fs.readDirectory(source);
    for (const [name] of entries) {
      await copyUriRecursively(vscode.Uri.joinPath(source, name), vscode.Uri.joinPath(target, name));
    }
    return;
  }

  await vscode.workspace.fs.writeFile(target, await vscode.workspace.fs.readFile(source));
}

async function uriExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function createChild(
  node: FileExplorerNode | undefined,
  kind: 'file' | 'folder',
  options: { provider: GoBenchFileExplorerProvider; output: vscode.OutputChannel }
): Promise<void> {
  const parent = await resolveDirectoryNode(node);
  if (!parent) {
    void vscode.window.showErrorMessage('Go Bench: open a workspace before creating files.');
    return;
  }

  const value = await vscode.window.showInputBox({
    prompt: kind === 'file' ? 'New file name' : 'New folder name',
    placeHolder: kind === 'file' ? 'path/to/file.go' : 'path/to/folder',
    validateInput: value => isSafeRelativePathInput(value) ? undefined : 'Enter a relative path inside this folder.'
  });
  if (value === undefined) {
    return;
  }

  const target = vscode.Uri.joinPath(parent.uri, ...splitRelativePathInput(value));
  try {
    if (kind === 'file') {
      await vscode.workspace.fs.writeFile(target, new Uint8Array());
      await vscode.window.showTextDocument(target);
    } else {
      await vscode.workspace.fs.createDirectory(target);
    }
    options.provider.refresh();
  } catch (error) {
    options.output.appendLine(`Go Bench Files: failed to create ${kind} ${target.fsPath}: ${String(error)}`);
    void vscode.window.showErrorMessage(`Go Bench: failed to create ${kind}.`);
  }
}

async function renameNode(
  node: FileExplorerNode | undefined,
  options: { provider: GoBenchFileExplorerProvider; output: vscode.OutputChannel }
): Promise<void> {
  if (!node) {
    return;
  }
  if (node.kind === 'workspaceFolder') {
    void vscode.window.showInformationMessage('Go Bench: workspace roots cannot be renamed from this view.');
    return;
  }

  const value = await vscode.window.showInputBox({
    prompt: `Rename ${node.label}`,
    value: node.label,
    validateInput: input => isSafeSingleNameInput(input) ? undefined : 'Enter a name inside the same parent.'
  });
  if (value === undefined || value.trim() === node.label) {
    return;
  }

  const target = vscode.Uri.joinPath(node.uri, '..', value.trim());
  try {
    await vscode.workspace.fs.rename(node.uri, target, { overwrite: false });
    options.provider.refresh();
  } catch (error) {
    options.output.appendLine(`Go Bench Files: failed to rename ${node.uri.fsPath}: ${String(error)}`);
    void vscode.window.showErrorMessage('Go Bench: failed to rename file or folder.');
  }
}

async function deleteNode(
  node: FileExplorerNode | undefined,
  options: { provider: GoBenchFileExplorerProvider; output: vscode.OutputChannel }
): Promise<void> {
  if (!node) {
    return;
  }
  if (node.kind === 'workspaceFolder') {
    void vscode.window.showInformationMessage('Go Bench: workspace roots cannot be deleted from this view.');
    return;
  }

  const confirmed = await vscode.window.showWarningMessage(
    `Delete "${node.label}" from disk?`,
    { modal: true },
    'Delete'
  );
  if (confirmed !== 'Delete') {
    return;
  }

  try {
    await vscode.workspace.fs.delete(node.uri, { recursive: node.kind === 'directory', useTrash: true });
    options.provider.refresh();
  } catch (error) {
    options.output.appendLine(`Go Bench Files: failed to delete ${node.uri.fsPath}: ${String(error)}`);
    void vscode.window.showErrorMessage('Go Bench: failed to delete file or folder.');
  }
}

async function resolveDirectoryNode(node?: FileExplorerNode): Promise<FileExplorerNode | undefined> {
  if (node) {
    return node.kind === 'file'
      ? {
          kind: 'directory',
          uri: vscode.Uri.joinPath(node.uri, '..'),
          label: basename(vscode.Uri.joinPath(node.uri, '..').fsPath),
          workspaceFolder: node.workspaceFolder
        }
      : node;
  }

  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (activeUri) {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(activeUri);
    if (workspaceFolder) {
      const parentUri = vscode.Uri.joinPath(activeUri, '..');
      return {
        kind: 'directory',
        uri: parentUri,
        label: basename(parentUri.fsPath),
        workspaceFolder
      };
    }
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    return undefined;
  }

  return {
    kind: 'workspaceFolder',
    uri: workspaceFolder.uri,
    label: workspaceFolder.name,
    workspaceFolder
  };
}

async function pickCurrentEditorNode(): Promise<FileExplorerNode | undefined> {
  const uri = vscode.window.activeTextEditor?.document.uri;
  if (!uri) {
    return undefined;
  }
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  if (!workspaceFolder) {
    return undefined;
  }

  return {
    kind: 'file',
    uri,
    label: basename(uri.fsPath),
    workspaceFolder
  };
}
