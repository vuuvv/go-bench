/**
 * Go Bench Tests 侧边栏视图。
 *
 * 该适配层复用现有 parser 和 `testingTargets` 纯数据树，把 Test Explorer 中的 module/package/file/
 * function/case 层级映射到 Go Bench Activity Bar。运行和调试入口继续委托现有命令，保持 Test
 * Results、runner 和 debug configuration 行为一致。
 */

import * as vscode from 'vscode';
import { commands, configurationKeys } from './constants';
import { readTableTestConfigFromWorkspace } from './codelens';
import { resolveGoModuleInfo } from './goModule';
import { GoHelperParser, isGoTestFile } from './parser';
import type { GoTestParser, SourceRange } from './parser';
import type { GoTestRunResult, GoTestRunTarget } from './runner';
import type {
  GoBenchRunTargetTestResultItem,
  GoBenchRunTargetTestResultTree,
  GoBenchRunTargetTestResultsOptions,
  GoBenchTestResultStatus
} from './testResults';
import type { TableTestConfig } from './tableTestConfig';
import {
  createGoTestFileNodeId,
  createGoTestTreeNodes,
  type GoTestTreeNode,
  type GoTestTreeNodeKind
} from './testingTargets';

const goTestFilePattern = '**/*_test.go';
const ignoredTestFilePattern = '**/{.git,node_modules,out}/**';

/** Go Bench Tests 侧边栏 provider 依赖项。 */
export type GoBenchSidebarTestsProviderOptions = {
  /** 共享 output channel，用于记录扫描和 parser 诊断。 */
  output: Pick<vscode.OutputChannel, 'appendLine'>;
  /** Go 测试文件 parser，默认使用 Go helper。 */
  parser?: GoTestParser;
  /** 读取当前配置的函数，默认从 VSCode workspace configuration 读取。 */
  getConfig?: () => TableTestConfig;
};

/** Tests 视图节点。 */
export type GoBenchSidebarTestNode = {
  id: string;
  label: string;
  kind: GoBenchSidebarTestNodeKind;
  file?: string;
  range?: SourceRange;
  runTarget?: GoTestRunTarget;
  status?: GoBenchSidebarTestStatus;
  children: GoBenchSidebarTestNode[];
  parent?: GoBenchSidebarTestNode;
};

type GoBenchSidebarTestNodeKind = GoTestTreeNodeKind | 'loading';
type GoBenchSidebarTestStatus = GoBenchTestResultStatus | 'debugging';

const loadingNode: GoBenchSidebarTestNode = {
  id: 'go-bench-sidebar-tests-loading',
  label: 'Loading tests...',
  kind: 'loading',
  children: []
};

/** Go Bench 侧边栏 Tests 视图的数据源。 */
export class GoBenchSidebarTestsProvider
  implements vscode.TreeDataProvider<GoBenchSidebarTestNode>, vscode.Disposable {
  private readonly treeDataDidChangeEmitter =
    new vscode.EventEmitter<GoBenchSidebarTestNode | undefined | null | void>();
  private readonly parser: GoTestParser;
  private readonly getConfig: () => TableTestConfig;
  private readonly output: Pick<vscode.OutputChannel, 'appendLine'>;
  private readonly nodesById = new Map<string, GoBenchSidebarTestNode>();
  private roots: GoBenchSidebarTestNode[] = [];
  private loading = false;

  public readonly onDidChangeTreeData = this.treeDataDidChangeEmitter.event;

  public constructor(options: GoBenchSidebarTestsProviderOptions) {
    this.parser = options.parser ?? new GoHelperParser();
    this.getConfig = options.getConfig ?? readTableTestConfigFromWorkspace;
    this.output = options.output;
  }

  /** 通知 VSCode 重新读取当前树。 */
  public refresh(): void {
    this.treeDataDidChangeEmitter.fire();
  }

  /** 重新扫描 workspace 中所有 Go 测试文件并重建 Tests 侧边栏树。 */
  public async refreshWorkspace(token?: vscode.CancellationToken): Promise<number> {
    const config = this.getConfig();
    if (!config.enabled) {
      this.clear();
      return 0;
    }

    this.loading = true;
    this.clearWithoutEvent();
    this.refresh();

    try {
      const uris = await vscode.workspace.findFiles(goTestFilePattern, ignoredTestFilePattern);

      let refreshed = 0;
      for (const uri of uris) {
        if (token?.isCancellationRequested) {
          break;
        }

        const document = await openWorkspaceDocument(uri);
        const changed = await this.refreshDocument(document, { fireEvent: false });
        if (changed) {
          refreshed++;
        }
      }

      this.output.appendLine(`Go Bench Tests: refreshed ${refreshed} Go test file(s).`);
      return refreshed;
    } finally {
      this.loading = false;
      this.refresh();
    }
  }

  /** 解析并替换单个 Go 测试文件对应的子树。 */
  public async refreshDocument(
    document: vscode.TextDocument,
    options: { fireEvent?: boolean } = {}
  ): Promise<boolean> {
    const file = document.uri.fsPath;
    if (!isGoTestFile(file)) {
      return false;
    }

    const config = this.getConfig();
    if (!config.enabled) {
      this.removeFileItems(file);
      if (options.fireEvent !== false) {
        this.refresh();
      }
      return false;
    }

    try {
      const parser =
        this.parser instanceof GoHelperParser ? new GoHelperParser({ nameFields: config.nameFields }) : this.parser;
      const parseResult = await parser.parseTestFile(file, document.getText());
      const moduleInfo = resolveGoModuleInfo(file);
      this.removeFileItems(file);

      if (!moduleInfo) {
        this.output.appendLine(`Go Bench Tests skipped ${file}: cannot find a valid go.mod module declaration.`);
        if (options.fireEvent !== false) {
          this.refresh();
        }
        return false;
      }

      for (const node of createGoTestTreeNodes(parseResult, config, {
        moduleDir: moduleInfo.dir,
        moduleName: moduleInfo.name
      })) {
        this.mergeRootNode(node);
      }

      if (options.fireEvent !== false) {
        this.refresh();
      }
      return true;
    } catch (error) {
      this.output.appendLine(`Go Bench Tests parse failed for ${file}: ${String(error)}`);
      this.removeFileItems(file);
      if (options.fireEvent !== false) {
        this.refresh();
      }
      return false;
    }
  }

  public getTreeItem(node: GoBenchSidebarTestNode): vscode.TreeItem {
    const collapsibleState =
      node.children.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
    const item = new vscode.TreeItem(node.label, collapsibleState);
    item.id = node.id;
    item.contextValue = createContextValue(node);
    item.iconPath = toThemeIcon(node.kind);
    item.tooltip = createTooltip(node);
    item.description = createDescription(node);

    if (node.file && node.kind !== 'module' && node.kind !== 'package') {
      item.command = {
        command: 'vscode.open',
        title: 'Open Test',
        arguments: [vscode.Uri.file(node.file), toOpenOptions(node.range)]
      };
    }

    return item;
  }

  public getChildren(node?: GoBenchSidebarTestNode): GoBenchSidebarTestNode[] {
    if (!node && this.loading) {
      return [loadingNode];
    }
    return sortTestNodes(node ? node.children : this.roots);
  }

  public getParent(node: GoBenchSidebarTestNode): GoBenchSidebarTestNode | undefined {
    return node.parent;
  }

  /** 查找某个 `_test.go` 文件对应的 file 节点，供标题区“定位当前文件测试”命令使用。 */
  public getFileNode(file: string): GoBenchSidebarTestNode | undefined {
    return this.nodesById.get(createGoTestFileNodeId(file));
  }

  /** 查找某个文件和光标位置下最具体的测试节点，优先 table case，其次测试函数，最后文件节点。 */
  public getBestNodeForPosition(file: string, position: vscode.Position): GoBenchSidebarTestNode | undefined {
    const fileNode = this.getFileNode(file);
    if (!fileNode) {
      return undefined;
    }

    return findBestNodeForPosition(fileNode, position) ?? fileNode;
  }

  /** 更新单个节点的最近一次运行状态。 */
  public setStatus(node: GoBenchSidebarTestNode, status: GoBenchSidebarTestStatus | undefined): void {
    const current = this.nodesById.get(node.id);
    if (!current) {
      return;
    }
    current.status = status;
    this.treeDataDidChangeEmitter.fire(current);
  }

  /** 按 runner target 更新节点状态，供 Test Results reporter 的 JSON 事件回调用。 */
  public setStatusForTarget(target: GoTestRunTarget, status: GoBenchSidebarTestStatus | undefined): void {
    const node = [...this.nodesById.values()].find(candidate =>
      candidate.runTarget ? isSameRunTarget(candidate.runTarget, target) : false
    );
    if (node) {
      this.setStatus(node, status);
    }
  }

  public dispose(): void {
    this.treeDataDidChangeEmitter.dispose();
  }

  private mergeRootNode(source: GoTestTreeNode): void {
    const existing = this.nodesById.get(source.id);
    if (!existing) {
      const node = createSidebarTestNode(source);
      this.roots.push(node);
      this.nodesById.set(node.id, node);
      for (const child of source.children) {
        this.mergeChildNode(node, child);
      }
      return;
    }

    updateSidebarTestNode(existing, source);
    for (const child of source.children) {
      this.mergeChildNode(existing, child);
    }
  }

  private mergeChildNode(parent: GoBenchSidebarTestNode, source: GoTestTreeNode): void {
    const existing = this.nodesById.get(source.id);
    if (!existing) {
      const node = createSidebarTestNode(source, parent);
      parent.children.push(node);
      this.nodesById.set(node.id, node);
      for (const child of source.children) {
        this.mergeChildNode(node, child);
      }
      return;
    }

    updateSidebarTestNode(existing, source);
    if (existing.parent !== parent) {
      removeChild(existing.parent, existing.id);
      existing.parent = parent;
      parent.children.push(existing);
    }
    for (const child of source.children) {
      this.mergeChildNode(existing, child);
    }
  }

  private removeFileItems(file: string): void {
    const fileItem = this.nodesById.get(createGoTestFileNodeId(file));
    if (!fileItem) {
      return;
    }

    const parent = fileItem.parent;
    this.deleteItemTree(fileItem);
    removeChild(parent, fileItem.id);
    this.pruneEmptyAncestors(parent);
  }

  private pruneEmptyAncestors(item: GoBenchSidebarTestNode | undefined): void {
    let current = item;
    while (current && current.children.length === 0 && !current.runTarget) {
      const parent = current.parent;
      this.deleteItemTree(current);
      removeChild(parent, current.id);
      current = parent;
    }
  }

  private deleteItemTree(node: GoBenchSidebarTestNode): void {
    for (const child of node.children) {
      this.deleteItemTree(child);
    }
    this.nodesById.delete(node.id);
    if (!node.parent) {
      this.roots = this.roots.filter(root => root.id !== node.id);
    }
  }

  private clear(): void {
    this.clearWithoutEvent();
    this.refresh();
  }

  private clearWithoutEvent(): void {
    this.nodesById.clear();
    this.roots = [];
  }
}

/** 注册 Tests 视图命令、文件监听和配置同步。 */
export function registerGoBenchSidebarTests(options: {
  provider: GoBenchSidebarTestsProvider;
  treeView: vscode.TreeView<GoBenchSidebarTestNode>;
  output: vscode.OutputChannel;
  refreshTestExplorer?: () => Promise<void>;
  runTest?: (target: GoTestRunTarget, options?: GoBenchRunTargetTestResultsOptions) => Promise<GoTestRunResult>;
  runTestTree?: (
    tree: GoBenchRunTargetTestResultTree,
    options?: Pick<GoBenchRunTargetTestResultsOptions, 'onStatus'>
  ) => Promise<GoTestRunResult>;
  debugTest?: (target: GoTestRunTarget) => Promise<boolean>;
}): vscode.Disposable {
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  const refreshWorkspaceSoon = (): void => {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      void options.provider.refreshWorkspace();
    }, 250);
  };

  const watcher = vscode.workspace.createFileSystemWatcher(goTestFilePattern);
  const workspaceFoldersSubscription = vscode.workspace.onDidChangeWorkspaceFolders(refreshWorkspaceSoon);
  const documentChangeSubscription = vscode.workspace.onDidChangeTextDocument(event => {
    void options.provider.refreshDocument(event.document);
  });
  const documentSaveSubscription = vscode.workspace.onDidSaveTextDocument(document => {
    void options.provider.refreshDocument(document);
  });
  const configurationSubscription = vscode.workspace.onDidChangeConfiguration(event => {
    if (Object.values(configurationKeys).some(key => key.startsWith('goBench.tableTests') && event.affectsConfiguration(key))) {
      refreshWorkspaceSoon();
    }
  });

  const refreshCommand = vscode.commands.registerCommand(commands.refreshSidebarTests, async () => {
    await options.provider.refreshWorkspace();
    await options.refreshTestExplorer?.();
  });
  const revealCurrentFileCommand = vscode.commands.registerCommand(commands.revealCurrentSidebarTest, async () => {
    const editor = vscode.window.activeTextEditor;
    const document = editor?.document;
    if (!document || !isGoTestFile(document.uri.fsPath)) {
      void vscode.window.showInformationMessage('Go Bench: open a Go _test.go file to reveal it in Tests.');
      return;
    }

    await options.provider.refreshDocument(document);
    const node = options.provider.getBestNodeForPosition(document.uri.fsPath, editor.selection.active);
    if (!node) {
      void vscode.window.showInformationMessage('Go Bench: no tests found for the current file.');
      return;
    }

    await options.treeView.reveal(node, { select: true, focus: true, expand: true });
  });
  const runCommand = vscode.commands.registerCommand(commands.runSidebarTest, async (node?: GoBenchSidebarTestNode) => {
    const targets = collectRunRootNodes(node);
    if (targets.length === 0) {
      void vscode.window.showInformationMessage('Go Bench: select a module, package, file, test function, or table case to run.');
      return;
    }

    if (node && !node.runTarget && options.runTestTree) {
      try {
        const result = await options.runTestTree(toTestResultTree(node), {
          onStatus: (target, status) => {
            options.provider.setStatusForTarget(target, status);
          }
        });
        if (!result.success) {
          void vscode.window.showErrorMessage(`Go Bench: ${node.label} failed.`);
        }
      } catch (error) {
        options.output.appendLine(`Go Bench Tests: failed to run ${node.label}: ${String(error)}`);
        void vscode.window.showErrorMessage(`Go Bench: ${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }

    for (const targetNode of targets) {
      if (!targetNode.runTarget) {
        continue;
      }
      options.provider.setStatus(targetNode, 'running');
      try {
        const childItems = collectChildRunItems(targetNode);
        const result = options.runTest
          ? await options.runTest(targetNode.runTarget, {
              itemRange: targetNode.range,
              childItems,
              onStatus: (target, status) => {
                options.provider.setStatusForTarget(target, status);
              }
            })
          : await vscode.commands.executeCommand<GoTestRunResult>(commands.runTest, targetNode.runTarget);
        const success = result?.success ?? false;
        options.provider.setStatus(targetNode, success ? 'passed' : 'failed');
        if (!success) {
          void vscode.window.showErrorMessage(`Go Bench: ${targetNode.runTarget.label} failed.`);
        }
      } catch (error) {
        options.provider.setStatus(targetNode, 'failed');
        options.output.appendLine(`Go Bench Tests: failed to run ${targetNode.runTarget.label}: ${String(error)}`);
        void vscode.window.showErrorMessage(`Go Bench: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  });
  const debugCommand = vscode.commands.registerCommand(commands.debugSidebarTest, async (node?: GoBenchSidebarTestNode) => {
    const targets = collectDebugRootNodes(node);
    if (targets.length === 0) {
      void vscode.window.showInformationMessage('Go Bench: select a module, package, file, test function, or table case to debug.');
      return;
    }

    for (const targetNode of targets) {
      if (!targetNode.runTarget) {
        continue;
      }
      options.provider.setStatus(targetNode, 'debugging');
      try {
        const started = options.debugTest
          ? await options.debugTest(targetNode.runTarget)
          : await vscode.commands.executeCommand<boolean>(commands.debugTest, targetNode.runTarget);
        if (!started) {
          options.provider.setStatus(targetNode, 'failed');
          void vscode.window.showErrorMessage(`Go Bench: failed to start debugging ${targetNode.runTarget.label}.`);
          continue;
        }
        options.provider.setStatus(targetNode, undefined);
      } catch (error) {
        options.provider.setStatus(targetNode, 'failed');
        options.output.appendLine(`Go Bench Tests: failed to debug ${targetNode.runTarget.label}: ${String(error)}`);
        void vscode.window.showErrorMessage(`Go Bench: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  });

  const fileChangeSubscriptions = [
    watcher.onDidCreate(refreshWorkspaceSoon),
    watcher.onDidDelete(refreshWorkspaceSoon),
    watcher.onDidChange(refreshWorkspaceSoon)
  ];

  void options.provider.refreshWorkspace();

  return vscode.Disposable.from(
    watcher,
    workspaceFoldersSubscription,
    documentChangeSubscription,
    documentSaveSubscription,
    configurationSubscription,
    refreshCommand,
    revealCurrentFileCommand,
    runCommand,
    debugCommand,
    ...fileChangeSubscriptions,
    new vscode.Disposable(() => {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
      }
    })
  );
}

function createSidebarTestNode(source: GoTestTreeNode, parent?: GoBenchSidebarTestNode): GoBenchSidebarTestNode {
  return {
    id: source.id,
    label: source.label,
    kind: source.kind,
    file: source.file,
    range: source.range,
    runTarget: source.runTarget,
    children: [],
    parent
  };
}

function updateSidebarTestNode(target: GoBenchSidebarTestNode, source: GoTestTreeNode): void {
  target.label = source.label;
  target.kind = source.kind;
  target.file = source.file;
  target.range = source.range;
  target.runTarget = source.runTarget;
}

function sortTestNodes(nodes: readonly GoBenchSidebarTestNode[]): GoBenchSidebarTestNode[] {
  return [...nodes].sort((left, right) => {
    const kindComparison = testNodeKindRank(left.kind) - testNodeKindRank(right.kind);
    if (kindComparison !== 0) {
      return kindComparison;
    }

    const labelComparison = left.label.localeCompare(right.label, undefined, {
      sensitivity: 'base',
      numeric: true
    });
    if (labelComparison !== 0) {
      return labelComparison;
    }

    return left.id.localeCompare(right.id, undefined, {
      sensitivity: 'base',
      numeric: true
    });
  });
}

function testNodeKindRank(kind: GoBenchSidebarTestNodeKind): number {
  switch (kind) {
    case 'loading':
      return 0;
    case 'module':
      return 1;
    case 'package':
      return 2;
    case 'file':
      return 3;
    case 'function':
      return 4;
    case 'case':
      return 5;
  }
}

function removeChild(parent: GoBenchSidebarTestNode | undefined, id: string): void {
  if (parent) {
    parent.children = parent.children.filter(child => child.id !== id);
  }
}

function findBestNodeForPosition(
  node: GoBenchSidebarTestNode,
  position: vscode.Position
): GoBenchSidebarTestNode | undefined {
  const childMatches = node.children
    .map(child => findBestNodeForPosition(child, position))
    .filter((child): child is GoBenchSidebarTestNode => child !== undefined)
    .sort((left, right) => rangeSize(left.range) - rangeSize(right.range));
  if (childMatches.length > 0) {
    return childMatches[0];
  }

  if (node.range && containsPosition(node.range, position)) {
    return node;
  }
  return undefined;
}

function containsPosition(range: SourceRange, position: vscode.Position): boolean {
  const start = new vscode.Position(range.start.line, range.start.character);
  const end = new vscode.Position(range.end.line, range.end.character);
  return position.isAfterOrEqual(start) && position.isBeforeOrEqual(end);
}

function rangeSize(range: SourceRange | undefined): number {
  if (!range) {
    return Number.POSITIVE_INFINITY;
  }
  return (range.end.line - range.start.line) * 100_000 + (range.end.character - range.start.character);
}

function createContextValue(node: GoBenchSidebarTestNode): string {
  if (node.runTarget) {
    return 'goBenchTestRunnable';
  }
  return hasRunnableFunctionChild(node) ? 'goBenchTestRunnableGroup' : 'goBenchTestGroup';
}

function toTestResultTree(node: GoBenchSidebarTestNode): GoBenchRunTargetTestResultTree {
  return {
    id: node.id,
    label: node.label,
    file: node.file,
    range: node.range,
    target: node.runTarget,
    children: node.children
      .filter(child => child.runTarget || hasRunnableFunctionChild(child))
      .map(child => toTestResultTree(child))
  };
}

function collectRunRootNodes(node: GoBenchSidebarTestNode | undefined): GoBenchSidebarTestNode[] {
  if (!node) {
    return [];
  }
  if (node.runTarget) {
    return [node];
  }
  return collectFunctionNodes(node);
}

function collectDebugRootNodes(node: GoBenchSidebarTestNode | undefined): GoBenchSidebarTestNode[] {
  return collectRunRootNodes(node);
}

function collectFunctionNodes(node: GoBenchSidebarTestNode): GoBenchSidebarTestNode[] {
  const nodes: GoBenchSidebarTestNode[] = [];
  for (const child of node.children) {
    if (child.kind === 'function' && child.runTarget) {
      nodes.push(child);
      continue;
    }
    nodes.push(...collectFunctionNodes(child));
  }
  return nodes;
}

function hasRunnableFunctionChild(node: GoBenchSidebarTestNode): boolean {
  return collectFunctionNodes(node).length > 0;
}

function collectChildRunItems(node: GoBenchSidebarTestNode): GoBenchRunTargetTestResultItem[] {
  const items: GoBenchRunTargetTestResultItem[] = [];
  for (const child of node.children) {
    if (child.runTarget) {
      items.push({ target: child.runTarget, range: child.range });
    }
    items.push(...collectChildRunItems(child));
  }
  return items;
}

function isSameRunTarget(left: GoTestRunTarget, right: GoTestRunTarget): boolean {
  return (
    left.file === right.file &&
    left.testName === right.testName &&
    left.subtestPath.length === right.subtestPath.length &&
    left.subtestPath.every((segment, index) => segment === right.subtestPath[index])
  );
}

function toThemeIcon(kind: GoBenchSidebarTestNodeKind): vscode.ThemeIcon {
  switch (kind) {
    case 'loading':
      return new vscode.ThemeIcon('sync~spin');
    case 'module':
      return new vscode.ThemeIcon('symbol-namespace');
    case 'package':
      return new vscode.ThemeIcon('symbol-package');
    case 'file':
      return new vscode.ThemeIcon('go-to-file');
    case 'function':
      return new vscode.ThemeIcon('symbol-method');
    case 'case':
      return new vscode.ThemeIcon('symbol-field');
  }
}

function createTooltip(node: GoBenchSidebarTestNode): string {
  if (node.runTarget) {
    return node.runTarget.label;
  }
  return node.file ?? node.label;
}

function createDescription(node: GoBenchSidebarTestNode): string | undefined {
  if (!node.file || (node.kind !== 'module' && node.kind !== 'file')) {
    return undefined;
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(node.file));
  if (!workspaceFolder || (vscode.workspace.workspaceFolders?.length ?? 0) < 2) {
    return undefined;
  }
  return workspaceFolder.name;
}

function toOpenOptions(range: SourceRange | undefined): vscode.TextDocumentShowOptions | undefined {
  if (!range) {
    return undefined;
  }
  return {
    selection: new vscode.Range(
      range.start.line,
      range.start.character,
      range.end.line,
      range.end.character
    ),
    preview: true
  };
}

async function openWorkspaceDocument(uri: vscode.Uri): Promise<vscode.TextDocument> {
  const openDocument = vscode.workspace.textDocuments.find(document => document.uri.toString() === uri.toString());
  if (openDocument) {
    return openDocument;
  }
  return await vscode.workspace.openTextDocument(uri);
}
