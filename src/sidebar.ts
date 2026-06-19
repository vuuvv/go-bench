/**
 * Go Bench 侧边栏骨架。
 *
 * 当前 Files 视图已经接入 workspace 文件树，Tests 视图复用 Go Bench 测试树模型；
 * Run and Debug 仍保留空 tree view，等待后续里程碑挂载 runnable 列表。
 */

import * as vscode from 'vscode';
import { sidebarViewIds } from './constants';
import { GoBenchFileExplorerProvider, registerGoBenchFileExplorer } from './fileExplorer';
import type { GoBenchRunTargetTestResultTree, GoBenchRunTargetTestResultsOptions } from './testResults';
import type { GoTestRunResult, GoTestRunTarget } from './runner';
import { GoBenchSidebarTestsProvider, registerGoBenchSidebarTests } from './sidebarTests';

/** 注册 Go Bench 侧边栏三个空视图及当前阶段可用的标题区命令。 */
export function registerGoBenchSidebar(options: {
  output: vscode.OutputChannel;
  refreshTests: () => Promise<void>;
  runTest: (target: GoTestRunTarget, options?: GoBenchRunTargetTestResultsOptions) => Promise<GoTestRunResult>;
  runTestTree: (tree: GoBenchRunTargetTestResultTree, options?: Pick<GoBenchRunTargetTestResultsOptions, 'onStatus'>) => Promise<GoTestRunResult>;
  debugTest: (target: GoTestRunTarget) => Promise<boolean>;
}): vscode.Disposable {
  const filesProvider = new GoBenchFileExplorerProvider();
  const testsProvider = new GoBenchSidebarTestsProvider({ output: options.output });
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
  const testsRegistration = registerGoBenchSidebarTests({
    provider: testsProvider,
    treeView: testsView,
    output: options.output,
    refreshTestExplorer: options.refreshTests,
    runTest: options.runTest,
    runTestTree: options.runTestTree,
    debugTest: options.debugTest
  });

  return vscode.Disposable.from(
    filesProvider,
    testsProvider,
    runAndDebugProvider,
    filesView,
    testsView,
    runAndDebugView,
    fileExplorerRegistration,
    testsRegistration
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
