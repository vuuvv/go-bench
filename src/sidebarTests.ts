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
import type { GoTestRunTarget } from './runner';
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
  kind: GoTestTreeNodeKind;
  file?: string;
  range?: SourceRange;
  runTarget?: GoTestRunTarget;
  children: GoBenchSidebarTestNode[];
  parent?: GoBenchSidebarTestNode;
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

    const uris = await vscode.workspace.findFiles(goTestFilePattern, ignoredTestFilePattern);
    this.clearWithoutEvent();

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

    this.refresh();
    this.output.appendLine(`Go Bench Tests: refreshed ${refreshed} Go test file(s).`);
    return refreshed;
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
    item.contextValue = node.runTarget ? 'goBenchTestRunnable' : 'goBenchTestGroup';
    item.iconPath = toThemeIcon(node.kind);
    item.tooltip = createTooltip(node);
    item.description = createDescription(node);

    if (node.file) {
      item.resourceUri = vscode.Uri.file(node.file);
    }

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
    return node ? node.children : this.roots;
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
  output: vscode.OutputChannel;
  refreshTestExplorer?: () => Promise<void>;
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
  const runCommand = vscode.commands.registerCommand(commands.runSidebarTest, async (node?: GoBenchSidebarTestNode) => {
    if (!node?.runTarget) {
      void vscode.window.showInformationMessage('Go Bench: select a test function or table case to run.');
      return;
    }
    await vscode.commands.executeCommand(commands.runTest, node.runTarget);
  });
  const debugCommand = vscode.commands.registerCommand(commands.debugSidebarTest, async (node?: GoBenchSidebarTestNode) => {
    if (!node?.runTarget) {
      void vscode.window.showInformationMessage('Go Bench: select a test function or table case to debug.');
      return;
    }
    await vscode.commands.executeCommand(commands.debugTest, node.runTarget);
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

function removeChild(parent: GoBenchSidebarTestNode | undefined, id: string): void {
  if (parent) {
    parent.children = parent.children.filter(child => child.id !== id);
  }
}

function toThemeIcon(kind: GoTestTreeNodeKind): vscode.ThemeIcon {
  switch (kind) {
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
