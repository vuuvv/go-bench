/**
 * Go Bench Files 侧边栏视图。
 *
 * 第一阶段实现和 VSCode Explorer 接近的核心工作流：workspace 根、懒加载目录、打开文件、
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
      return (vscode.workspace.workspaceFolders ?? []).map(workspaceFolder => ({
        kind: 'workspaceFolder',
        uri: workspaceFolder.uri,
        label: workspaceFolder.name,
        workspaceFolder
      }));
    }

    if (node.kind === 'file') {
      return [];
    }

    const entries = await vscode.workspace.fs.readDirectory(node.uri);
    return sortFileExplorerEntries(
      entries.map(([name, type]) => ({
        name,
        isDirectory: (type & vscode.FileType.Directory) !== 0
      }))
    ).map(entry => ({
      kind: entry.isDirectory ? 'directory' : 'file',
      uri: vscode.Uri.joinPath(node.uri, entry.name),
      label: entry.name,
      workspaceFolder: node.workspaceFolder
    }));
  }

  public dispose(): void {
    this.treeDataDidChangeEmitter.dispose();
  }
}

export function registerGoBenchFileExplorer(options: {
  provider: GoBenchFileExplorerProvider;
  output: vscode.OutputChannel;
}): vscode.Disposable {
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;

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
  const newFileCommand = vscode.commands.registerCommand(commands.newSidebarFile, async (node?: FileExplorerNode) => {
    await createChild(node, 'file', options);
  });
  const newFolderCommand = vscode.commands.registerCommand(commands.newSidebarFolder, async (node?: FileExplorerNode) => {
    await createChild(node, 'folder', options);
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
    newFileCommand,
    newFolderCommand,
    renameCommand,
    deleteCommand,
    revealCommand,
    copyRelativePathCommand,
    copyAbsolutePathCommand,
    ...fileChangeSubscriptions,
    new vscode.Disposable(() => {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
      }
    })
  );
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
