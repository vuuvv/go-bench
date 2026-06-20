/**
 * Go Bench 侧边栏骨架。
 *
 * 当前 Files 视图已经接入 workspace 文件树，Tests 视图复用 Go Bench 测试树模型；
 * Run and Debug 视图接入 workspace 级持久化 runnable 列表。
 */

import * as vscode from 'vscode';
import { sidebarViewIds } from './constants';
import { GoBenchFileExplorerProvider, registerGoBenchFileExplorer } from './fileExplorer';
import { GoBenchRunnablesDragAndDropController, GoBenchRunnablesProvider, registerGoBenchRunnables } from './runnables';
import type { GoBenchRunTargetTestResultTree, GoBenchRunTargetTestResultsOptions } from './testResults';
import type { GoTestRunResult, GoTestRunTarget } from './runner';
import { GoBenchSidebarTestsProvider, registerGoBenchSidebarTests } from './sidebarTests';

/** 注册 Go Bench 侧边栏三个空视图及当前阶段可用的标题区命令。 */
export function registerGoBenchSidebar(options: {
  context: vscode.ExtensionContext;
  output: vscode.OutputChannel;
  refreshTests: () => Promise<void>;
  runTest: (target: GoTestRunTarget, options?: GoBenchRunTargetTestResultsOptions) => Promise<GoTestRunResult>;
  runTestTree: (tree: GoBenchRunTargetTestResultTree, options?: Pick<GoBenchRunTargetTestResultsOptions, 'onStatus'>) => Promise<GoTestRunResult>;
  debugTest: (target: GoTestRunTarget) => Promise<boolean>;
}): vscode.Disposable {
  const filesProvider = new GoBenchFileExplorerProvider();
  const testsProvider = new GoBenchSidebarTestsProvider({ output: options.output });
  const runAndDebugProvider = new GoBenchRunnablesProvider();
  const runAndDebugDragAndDropController = new GoBenchRunnablesDragAndDropController({ provider: runAndDebugProvider });

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
    dragAndDropController: runAndDebugDragAndDropController,
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
  const runnablesRegistration = registerGoBenchRunnables({
    context: options.context,
    provider: runAndDebugProvider,
    output: options.output
  });

  return vscode.Disposable.from(
    filesProvider,
    testsProvider,
    runAndDebugProvider,
    filesView,
    testsView,
    runAndDebugView,
    fileExplorerRegistration,
    testsRegistration,
    runnablesRegistration
  );
}
