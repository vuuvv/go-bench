/**
 * Go Bench 侧边栏骨架。
 *
 * 当前 Files 视图已经接入 workspace 文件树；Tests 和 Run and Debug 仍保留空 tree view，
 * 等待后续里程碑挂载对应模型。
 */

import * as vscode from 'vscode';
import { commands, sidebarViewIds } from './constants';
import { GoBenchFileExplorerProvider, registerGoBenchFileExplorer } from './fileExplorer';

/** 注册 Go Bench 侧边栏三个空视图及当前阶段可用的标题区命令。 */
export function registerGoBenchSidebar(options: {
  output: vscode.OutputChannel;
  refreshTests: () => Promise<void>;
}): vscode.Disposable {
  const filesProvider = new GoBenchFileExplorerProvider();
  const testsProvider = new EmptySidebarTreeDataProvider();
  const runAndDebugProvider = new EmptySidebarTreeDataProvider();

  const filesView = vscode.window.createTreeView(sidebarViewIds.files, {
    treeDataProvider: filesProvider,
    showCollapseAll: true
  });
  const testsView = vscode.window.createTreeView(sidebarViewIds.tests, {
    treeDataProvider: testsProvider,
    showCollapseAll: false
  });
  const runAndDebugView = vscode.window.createTreeView(sidebarViewIds.runAndDebug, {
    treeDataProvider: runAndDebugProvider,
    showCollapseAll: false
  });

  const fileExplorerRegistration = registerGoBenchFileExplorer({ provider: filesProvider, output: options.output });

  const refreshTestsCommand = vscode.commands.registerCommand(commands.refreshSidebarTests, async () => {
    testsProvider.refresh();
    options.output.appendLine('Go Bench sidebar: refreshed Tests view scaffold.');
    await options.refreshTests();
  });

  return vscode.Disposable.from(
    filesProvider,
    testsProvider,
    runAndDebugProvider,
    filesView,
    testsView,
    runAndDebugView,
    fileExplorerRegistration,
    refreshTestsCommand
  );
}

class EmptySidebarTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable {
  private readonly treeDataDidChangeEmitter = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();

  public readonly onDidChangeTreeData = this.treeDataDidChangeEmitter.event;

  public refresh(): void {
    this.treeDataDidChangeEmitter.fire();
  }

  public getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  public getChildren(): vscode.ProviderResult<vscode.TreeItem[]> {
    return [];
  }

  public dispose(): void {
    this.treeDataDidChangeEmitter.dispose();
  }
}
