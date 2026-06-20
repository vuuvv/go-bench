/**
 * Go Bench Run and Debug 侧边栏视图。
 *
 * 该模块负责 VSCode 交互层：把 workspace settings 中的 runnable 列表展示为 tree view，并注册添加、
 * 编辑、删除、运行、调试和打开目标命令。数据建模和命令构造放在 `runnablesModel`，便于单测覆盖。
 */

import { basename, dirname, extname, relative, sep } from 'node:path';
import * as vscode from 'vscode';
import { commands, configurationKeys } from './constants';
import type { FileExplorerNode } from './fileExplorer';
import { resolveGoModuleInfo } from './goModule';
import {
  addOrUpdateRunnable,
  assignRunnableGroup,
  buildRunnableTreeRoots,
  buildGoRunCommand,
  buildRunnableDebugConfiguration,
  createRunnableGroup,
  createRunnableItem,
  editRunnableItem,
  isExecutableGoFileContent,
  parseGoPackageName,
  parseRunnableArgs,
  parseRunnableEnv,
  removeRunnableGroup,
  removeRunnable,
  resolvePersistedPath,
  type GoBenchRunnableGroup,
  type GoBenchRunnableItem,
  type GoBenchRunnableKind,
  type GoBenchRunnableTreeRoot,
  type RunnableWorkspaceFolder
} from './runnablesModel';

type RunnableTreeNode =
  | {
      kind: 'empty';
      label: string;
    }
  | {
      kind: 'group';
      group: GoBenchRunnableGroup;
      items: GoBenchRunnableItem[];
    }
  | {
      kind: 'runnable';
      item: GoBenchRunnableItem;
    }
  | {
      kind: 'stackFrame';
      frame: RunnableDebugStackFrame;
    };

type RunnableRuntimeOptions = {
  provider: GoBenchRunnablesProvider;
  output: vscode.OutputChannel;
  runningTerminals: Map<string, vscode.Terminal>;
  debugSessions: Map<string, vscode.DebugSession>;
  pendingDebugSessionItems: Map<string, string>;
  resumedDebugStackSuppressions: Map<string, number>;
  runnableNodeClicks: Map<string, number>;
};

type RunnableRuntimeState = 'stopped' | 'running' | 'debugging';

type RunnableDebugState = 'running' | 'paused';

type RunnableDebugStackFrame = {
  itemId: string;
  id: number;
  threadId: number;
  label: string;
  detail?: string;
  sourcePath?: string;
  line?: number;
  column?: number;
};

type DapStackTraceResponse = {
  stackFrames?: Array<{
    id: number;
    name: string;
    source?: {
      path?: string;
    };
    line?: number;
    column?: number;
  }>;
};

type RunnableDebugControlAction = 'pause' | 'continue' | 'stepOver' | 'stepInto' | 'stepOut';

const runnableDragMimeType = 'application/vnd.code.tree.goBench.sidebar.runAndDebug';
const runnableDoubleClickMs = 450;

/** Run and Debug 视图的数据提供器，直接从 workspace settings 读取最新 runnable 列表。 */
export class GoBenchRunnablesProvider
  implements vscode.TreeDataProvider<RunnableTreeNode>, vscode.Disposable {
  private readonly treeDataDidChangeEmitter = new vscode.EventEmitter<RunnableTreeNode | undefined | null | void>();
  private readonly runtimeStates = new Map<string, Exclude<RunnableRuntimeState, 'stopped'>>();
  private readonly debugStates = new Map<string, RunnableDebugState>();
  private readonly debugStackFrames = new Map<string, RunnableDebugStackFrame[]>();

  public readonly onDidChangeTreeData = this.treeDataDidChangeEmitter.event;

  public refresh(): void {
    this.treeDataDidChangeEmitter.fire();
  }

  /** 记录运行态，让 TreeItem 图标和 inline action 能和 terminal/debug session 同步。 */
  public setRuntimeState(id: string, state: Exclude<RunnableRuntimeState, 'stopped'>): void {
    this.runtimeStates.set(id, state);
    this.refresh();
  }

  /** 记录 debug adapter 暂停/继续状态，用于切换标准调试按钮和堆栈子节点。 */
  public setDebugState(id: string, state: RunnableDebugState): void {
    this.debugStates.set(id, state);
    this.refresh();
  }

  /** 查询调试暂停状态；没有记录时按继续运行处理。 */
  public getDebugState(id: string): RunnableDebugState {
    return this.debugStates.get(id) ?? 'running';
  }

  /** 保存当前 debug adapter 返回的调用栈帧，作为 runnable 的子节点展示。 */
  public setDebugStackFrames(id: string, frames: RunnableDebugStackFrame[]): void {
    if (frames.length === 0) {
      this.debugStackFrames.delete(id);
    } else {
      this.debugStackFrames.set(id, frames);
    }
    this.refresh();
  }

  /** 清除指定 runnable 的暂停堆栈。 */
  public clearDebugStackFrames(id: string): void {
    this.debugStackFrames.delete(id);
    this.refresh();
  }

  public getDebugStackFrames(id: string): RunnableDebugStackFrame[] {
    return this.debugStackFrames.get(id) ?? [];
  }

  /** 清除运行态，回到未运行按钮集合。 */
  public clearRuntimeState(id: string): void {
    this.runtimeStates.delete(id);
    this.debugStates.delete(id);
    this.debugStackFrames.delete(id);
    this.refresh();
  }

  /** 查询当前运行态，用于 restart 时保留 run/debug 模式。 */
  public getRuntimeState(id: string): RunnableRuntimeState {
    return this.runtimeStates.get(id) ?? 'stopped';
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

    if (node.kind === 'group') {
      const item = new vscode.TreeItem(node.group.label, vscode.TreeItemCollapsibleState.Expanded);
      item.description = `${node.items.length} item${node.items.length === 1 ? '' : 's'}`;
      item.tooltip = `${node.group.label}\n${node.items.length} runnable target${node.items.length === 1 ? '' : 's'}`;
      item.contextValue = node.items.some(child => this.getRuntimeState(child.id) !== 'stopped')
        ? 'goBenchRunnableGroupRunning'
        : 'goBenchRunnableGroupStopped';
      item.iconPath = new vscode.ThemeIcon('folder');
      return item;
    }

    if (node.kind === 'stackFrame') {
      const item = new vscode.TreeItem(node.frame.label, vscode.TreeItemCollapsibleState.None);
      item.description = node.frame.detail;
      item.tooltip = [node.frame.label, node.frame.sourcePath, node.frame.line ? `line ${node.frame.line}` : undefined]
        .filter(Boolean)
        .join('\n');
      item.iconPath = new vscode.ThemeIcon('callstack-view-session');
      item.contextValue = 'goBenchRunnableStackFrame';
      if (node.frame.sourcePath && node.frame.line) {
        item.command = {
          command: commands.openRunnableStackFrame,
          title: 'Open Stack Frame',
          arguments: [node.frame]
        };
      }
      return item;
    }

    const debugFrames = this.getDebugStackFrames(node.item.id);
    const collapsibleState = debugFrames.length > 0
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.None;
    const treeItem = new vscode.TreeItem(node.item.label, collapsibleState);
    const runtimeState = this.getRuntimeState(node.item.id);
    const debugState = this.getDebugState(node.item.id);
    treeItem.tooltip = `${node.item.label}\n${node.item.uri}\npackage: ${node.item.packageName ?? 'unknown'}\nworkspace: ${node.item.workspaceFolder}`;
    treeItem.contextValue = formatRunnableContextValue(runtimeState, debugState);
    treeItem.iconPath = getRunnableIcon(node.item, runtimeState, debugState);
    treeItem.command = {
      command: commands.focusRunnableResult,
      title: runtimeState === 'stopped' ? 'Open on Double Click' : 'Focus Result View',
      arguments: [node.item]
    };
    return treeItem;
  }

  public getChildren(node?: RunnableTreeNode): vscode.ProviderResult<RunnableTreeNode[]> {
    if (node?.kind === 'group') {
      return node.items.map(item => ({ kind: 'runnable', item }));
    }
    if (node?.kind === 'runnable') {
      return this.getDebugStackFrames(node.item.id).map(frame => ({ kind: 'stackFrame', frame }));
    }
    if (node?.kind === 'stackFrame') {
      return [];
    }
    if (node) {
      return [];
    }

    const items = readRunnableItems();
    const groups = readRunnableGroups();
    if (items.length === 0 && groups.length === 0) {
      return [{ kind: 'empty', label: 'Add current file' }];
    }
    return buildRunnableTreeRoots(items, groups).map(rootToTreeNode);
  }

  public dispose(): void {
    this.runtimeStates.clear();
    this.debugStates.clear();
    this.debugStackFrames.clear();
    this.treeDataDidChangeEmitter.dispose();
  }
}

/** 支持把 runnable 拖入 group，或拖到根层级以移出 group。 */
export class GoBenchRunnablesDragAndDropController implements vscode.TreeDragAndDropController<RunnableTreeNode> {
  public readonly dragMimeTypes = [runnableDragMimeType];
  public readonly dropMimeTypes = [runnableDragMimeType];

  public constructor(private readonly options: { provider: GoBenchRunnablesProvider }) {}

  public handleDrag(source: readonly RunnableTreeNode[], dataTransfer: vscode.DataTransfer): void {
    const itemIds = source
      .filter((node): node is Extract<RunnableTreeNode, { kind: 'runnable' }> => node.kind === 'runnable')
      .map(node => node.item.id);
    if (itemIds.length === 0) {
      return;
    }
    dataTransfer.set(runnableDragMimeType, new vscode.DataTransferItem(JSON.stringify(itemIds)));
  }

  public async handleDrop(target: RunnableTreeNode | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    const transferItem = dataTransfer.get(runnableDragMimeType);
    const rawValue = transferItem?.value;
    if (typeof rawValue !== 'string') {
      return;
    }

    const itemIds = parseDraggedRunnableIds(rawValue);
    if (itemIds.length === 0) {
      return;
    }

    const groupId = resolveDropGroupId(target);
    let items = readRunnableItems();
    for (const itemId of itemIds) {
      items = assignRunnableGroup(items, itemId, groupId);
    }
    await writeRunnableItems(items);
    this.options.provider.refresh();
  }
}

/** 注册 Run and Debug 视图命令、配置监听和 runnable 操作。 */
export function registerGoBenchRunnables(options: {
  provider: GoBenchRunnablesProvider;
  output: vscode.OutputChannel;
}): vscode.Disposable {
  const runningTerminals = new Map<string, vscode.Terminal>();
  const debugSessions = new Map<string, vscode.DebugSession>();
  const pendingDebugSessionItems = new Map<string, string>();
  const resumedDebugStackSuppressions = new Map<string, number>();
  const runnableNodeClicks = new Map<string, number>();
  const runtimeOptions = {
    ...options,
    runningTerminals,
    debugSessions,
    pendingDebugSessionItems,
    resumedDebugStackSuppressions,
    runnableNodeClicks
  };
  const configurationSubscription = vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration(configurationKeys.runnableItems) || event.affectsConfiguration(configurationKeys.runnableGroups)) {
      options.provider.refresh();
    }
  });
  const terminalCloseSubscription = vscode.window.onDidCloseTerminal(terminal => {
    for (const [id, runningTerminal] of runningTerminals) {
      if (runningTerminal === terminal) {
        runningTerminals.delete(id);
        options.provider.clearRuntimeState(id);
      }
    }
  });
  const debugSessionStartSubscription = vscode.debug.onDidStartDebugSession(session => {
    const itemId = pendingDebugSessionItems.get(session.configuration.name);
    if (!itemId) {
      return;
    }

    pendingDebugSessionItems.delete(session.configuration.name);
    debugSessions.set(itemId, session);
    options.provider.setRuntimeState(itemId, 'debugging');
  });
  const debugSessionTerminateSubscription = vscode.debug.onDidTerminateDebugSession(session => {
    for (const [id, debugSession] of debugSessions) {
      if (debugSession === session) {
        debugSessions.delete(id);
        options.provider.clearRuntimeState(id);
      }
    }
  });
  const debugSessionCustomEventSubscription = vscode.debug.onDidReceiveDebugSessionCustomEvent(event => {
    const itemId = findRunnableIdByDebugSession(event.session, debugSessions);
    if (!itemId) {
      return;
    }

    if (event.event === 'stopped') {
      resumedDebugStackSuppressions.delete(itemId);
      options.provider.setDebugState(itemId, 'paused');
      void refreshDebugStackFrames(itemId, event.session, event.body);
      return;
    }

    if (event.event === 'continued') {
      resumedDebugStackSuppressions.set(itemId, Date.now() + 1_500);
      options.provider.setDebugState(itemId, 'running');
      options.provider.clearDebugStackFrames(itemId);
    }
  });
  const activeStackItemSubscription = vscode.debug.onDidChangeActiveStackItem(stackItem => {
    const session = resolveStackItemSession(stackItem);
    const itemId = session ? findRunnableIdByDebugSession(session, debugSessions) : undefined;
    if (!session || !itemId) {
      return;
    }
    if (Date.now() < (resumedDebugStackSuppressions.get(itemId) ?? 0)) {
      return;
    }
    options.provider.setDebugState(itemId, 'paused');
    void refreshDebugStackFrames(itemId, session, stackItem);
  });

  async function refreshDebugStackFrames(itemId: string, session: vscode.DebugSession, source: unknown): Promise<void> {
    const threadId = resolveDebugThreadId(source);
    if (threadId === undefined) {
      return;
    }

    const frames = await readDebugStackFrames(itemId, session, threadId, options.output);
    options.provider.setDebugStackFrames(itemId, frames);
  }

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
  const scanCommand = vscode.commands.registerCommand(commands.scanRunnableFiles, async () => {
    await scanRunnableFiles(options);
  });
  const createGroupCommand = vscode.commands.registerCommand(commands.createRunnableGroup, async () => {
    await createGroup(options);
  });
  const moveToGroupCommand = vscode.commands.registerCommand(commands.moveRunnableToGroup, async (itemOrNode?: GoBenchRunnableItem | RunnableTreeNode) => {
    const item = normalizeRunnableCommandArgument(itemOrNode);
    if (!item) {
      return;
    }
    await moveRunnableToGroup(item, options);
  });
  const runGroupCommand = vscode.commands.registerCommand(commands.runRunnableGroup, async (node?: RunnableTreeNode) => {
    const group = normalizeRunnableGroupCommandArgument(node);
    if (!group) {
      return;
    }
    await runRunnableGroup(group, runtimeOptions);
  });
  const stopGroupCommand = vscode.commands.registerCommand(commands.stopRunnableGroup, async (node?: RunnableTreeNode) => {
    const group = normalizeRunnableGroupCommandArgument(node);
    if (!group) {
      return;
    }
    await stopRunnableGroup(group, runtimeOptions);
  });
  const restartGroupCommand = vscode.commands.registerCommand(commands.restartRunnableGroup, async (node?: RunnableTreeNode) => {
    const group = normalizeRunnableGroupCommandArgument(node);
    if (!group) {
      return;
    }
    await restartRunnableGroup(group, runtimeOptions);
  });
  const debugGroupCommand = vscode.commands.registerCommand(commands.debugRunnableGroup, async (node?: RunnableTreeNode) => {
    const group = normalizeRunnableGroupCommandArgument(node);
    if (!group) {
      return;
    }
    await debugRunnableGroup(group, runtimeOptions);
  });
  const removeGroupItemsCommand = vscode.commands.registerCommand(commands.removeRunnableGroupItems, async (node?: RunnableTreeNode) => {
    const group = normalizeRunnableGroupCommandArgument(node);
    if (!group) {
      return;
    }
    await removeGroupItems(group, runtimeOptions);
  });
  const removeGroupCommand = vscode.commands.registerCommand(commands.removeRunnableGroup, async (node?: RunnableTreeNode) => {
    const group = normalizeRunnableGroupCommandArgument(node);
    if (!group) {
      return;
    }
    await removeGroup(group, options);
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
    await runRunnable(item, runtimeOptions);
  });
  const stopCommand = vscode.commands.registerCommand(commands.stopRunnable, async (itemOrNode?: GoBenchRunnableItem | RunnableTreeNode) => {
    const item = normalizeRunnableCommandArgument(itemOrNode);
    if (!item) {
      return;
    }
    await stopRunnable(item, runtimeOptions);
  });
  const restartCommand = vscode.commands.registerCommand(commands.restartRunnable, async (itemOrNode?: GoBenchRunnableItem | RunnableTreeNode) => {
    const item = normalizeRunnableCommandArgument(itemOrNode);
    if (!item) {
      return;
    }
    await restartRunnable(item, runtimeOptions);
  });
  const debugCommand = vscode.commands.registerCommand(commands.debugRunnable, async (itemOrNode?: GoBenchRunnableItem | RunnableTreeNode) => {
    const item = normalizeRunnableCommandArgument(itemOrNode);
    if (!item) {
      return;
    }
    await debugRunnable(item, runtimeOptions);
  });
  const pauseDebugCommand = vscode.commands.registerCommand(commands.pauseRunnableDebug, async (itemOrNode?: GoBenchRunnableItem | RunnableTreeNode) => {
    const item = normalizeRunnableCommandArgument(itemOrNode);
    if (!item) {
      return;
    }
    await runDebugControl(item, runtimeOptions, 'pause');
  });
  const continueDebugCommand = vscode.commands.registerCommand(commands.continueRunnableDebug, async (itemOrNode?: GoBenchRunnableItem | RunnableTreeNode) => {
    const item = normalizeRunnableCommandArgument(itemOrNode);
    if (!item) {
      return;
    }
    await runDebugControl(item, runtimeOptions, 'continue');
  });
  const stepOverDebugCommand = vscode.commands.registerCommand(commands.stepOverRunnableDebug, async (itemOrNode?: GoBenchRunnableItem | RunnableTreeNode) => {
    const item = normalizeRunnableCommandArgument(itemOrNode);
    if (!item) {
      return;
    }
    await runDebugControl(item, runtimeOptions, 'stepOver');
  });
  const stepIntoDebugCommand = vscode.commands.registerCommand(commands.stepIntoRunnableDebug, async (itemOrNode?: GoBenchRunnableItem | RunnableTreeNode) => {
    const item = normalizeRunnableCommandArgument(itemOrNode);
    if (!item) {
      return;
    }
    await runDebugControl(item, runtimeOptions, 'stepInto');
  });
  const stepOutDebugCommand = vscode.commands.registerCommand(commands.stepOutRunnableDebug, async (itemOrNode?: GoBenchRunnableItem | RunnableTreeNode) => {
    const item = normalizeRunnableCommandArgument(itemOrNode);
    if (!item) {
      return;
    }
    await runDebugControl(item, runtimeOptions, 'stepOut');
  });
  const revealCommand = vscode.commands.registerCommand(commands.revealRunnable, async (itemOrNode?: GoBenchRunnableItem | RunnableTreeNode) => {
    const item = normalizeRunnableCommandArgument(itemOrNode);
    if (!item) {
      return;
    }
    await revealRunnable(item);
  });
  const openStackFrameCommand = vscode.commands.registerCommand(commands.openRunnableStackFrame, async (frame?: RunnableDebugStackFrame) => {
    if (!frame) {
      return;
    }
    await openStackFrame(frame);
  });
  const focusDebugConsoleCommand = vscode.commands.registerCommand(commands.focusRunnableDebugConsole, async () => {
    await focusDebugConsole();
  });
  const focusResultCommand = vscode.commands.registerCommand(commands.focusRunnableResult, async (itemOrNode?: GoBenchRunnableItem | RunnableTreeNode) => {
    const item = normalizeRunnableCommandArgument(itemOrNode);
    if (!item) {
      return;
    }
    await handleRunnableNodeClick(item, runtimeOptions);
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
    terminalCloseSubscription,
    debugSessionStartSubscription,
    debugSessionTerminateSubscription,
    debugSessionCustomEventSubscription,
    activeStackItemSubscription,
    addCurrentFileCommand,
    addFileCommand,
    addPackageCommand,
    scanCommand,
    createGroupCommand,
    moveToGroupCommand,
    runGroupCommand,
    stopGroupCommand,
    restartGroupCommand,
    debugGroupCommand,
    removeGroupItemsCommand,
    removeGroupCommand,
    removeCommand,
    editCommand,
    runCommand,
    stopCommand,
    restartCommand,
    debugCommand,
    pauseDebugCommand,
    continueDebugCommand,
    stepOverDebugCommand,
    stepIntoDebugCommand,
    stepOutDebugCommand,
    revealCommand,
    openStackFrameCommand,
    focusDebugConsoleCommand,
    focusResultCommand,
    copyPathCommand,
    new vscode.Disposable(() => {
      runningTerminals.clear();
      debugSessions.clear();
      pendingDebugSessionItems.clear();
      resumedDebugStackSuppressions.clear();
      runnableNodeClicks.clear();
    })
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
  const packageName = await readGoPackageName(uri, kind);
  const labelInput = buildRunnableLabelInput(uri.fsPath, kind);
  const input = { kind, path: uri.fsPath, workspaceFolder: workspace, packageName, ...labelInput };
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

async function scanRunnableFiles(options: {
  provider: GoBenchRunnablesProvider;
  output: vscode.OutputChannel;
}): Promise<void> {
  const files = await vscode.workspace.findFiles('**/*.go', '**/{vendor,.git,node_modules}/**');
  const candidates = await Promise.all(files.filter(uri => !uri.fsPath.endsWith('_test.go')).map(readExecutableGoFileCandidate));
  const executableFiles = candidates.filter((candidate): candidate is ScanRunnableCandidate => candidate !== undefined);
  if (executableFiles.length === 0) {
    void vscode.window.showInformationMessage('Go Bench: no executable Go files found.');
    return;
  }

  const selected = await vscode.window.showQuickPick(
    executableFiles.map(candidate => ({
      label: candidate.label,
      description: `package ${candidate.packageName}`,
      detail: vscode.workspace.asRelativePath(candidate.uri, false),
      candidate,
      picked: !readRunnableItems().some(item => item.id === createRunnableItem({
        kind: 'goFile',
        path: candidate.uri.fsPath,
        workspaceFolder: candidate.workspaceFolder,
        packageName: candidate.packageName,
        moduleName: candidate.moduleName,
        packageImportPath: candidate.packageImportPath
      }).id)
    })),
    {
      canPickMany: true,
      title: 'Add executable Go files to Go Bench Run and Debug',
      placeHolder: 'Select package main files to add'
    }
  );
  if (!selected || selected.length === 0) {
    return;
  }

  const currentItems = readRunnableItems();
  let nextItems = currentItems;
  let added = 0;
  let updated = 0;
  for (const selection of selected) {
    const result = addOrUpdateRunnable(nextItems, {
      kind: 'goFile',
      path: selection.candidate.uri.fsPath,
      workspaceFolder: selection.candidate.workspaceFolder,
      packageName: selection.candidate.packageName,
      moduleName: selection.candidate.moduleName,
      packageImportPath: selection.candidate.packageImportPath
    });
    nextItems = result.items;
    if (result.action === 'added') {
      added += 1;
    } else {
      updated += 1;
    }
  }

  await writeRunnableItems(nextItems);
  options.provider.refresh();
  void vscode.window.showInformationMessage(`Go Bench: added ${added} and updated ${updated} runnable file(s).`);
}

async function createGroup(options: { provider: GoBenchRunnablesProvider; output: vscode.OutputChannel }): Promise<GoBenchRunnableGroup | undefined> {
  const label = await vscode.window.showInputBox({
    prompt: 'Runnable group name',
    validateInput: value => value.trim() === '' ? 'Enter a group name.' : undefined
  });
  if (label === undefined) {
    return undefined;
  }

  const group = createRunnableGroup({ label });
  await writeRunnableGroups([...readRunnableGroups(), group]);
  options.provider.refresh();
  return group;
}

async function moveRunnableToGroup(
  item: GoBenchRunnableItem,
  options: { provider: GoBenchRunnablesProvider; output: vscode.OutputChannel }
): Promise<void> {
  const groups = readRunnableGroups();
  const picks = [
    { label: 'Root level', description: 'Remove from group', groupId: undefined as string | undefined, create: false },
    { label: 'New group...', description: 'Create a group and move this runnable into it', groupId: undefined, create: true },
    ...groups.map(group => ({
      label: group.label,
      description: 'Move into this group',
      groupId: group.id,
      create: false
    }))
  ];
  const selected = await vscode.window.showQuickPick(picks, {
    title: `Archive "${item.label}" to a group`,
    placeHolder: 'Choose a group'
  });
  if (!selected) {
    return;
  }

  let groupId = selected.groupId;
  if (selected.create) {
    const group = await createGroup(options);
    if (!group) {
      return;
    }
    groupId = group.id;
  }

  await writeRunnableItems(assignRunnableGroup(readRunnableItems(), item.id, groupId));
  options.provider.refresh();
}

async function runRunnableGroup(
  groupNode: Extract<RunnableTreeNode, { kind: 'group' }>,
  options: RunnableRuntimeOptions
): Promise<void> {
  if (groupNode.items.length === 0) {
    void vscode.window.showInformationMessage(`Go Bench: group "${groupNode.group.label}" has no runnable items.`);
    return;
  }

  options.output.appendLine('');
  options.output.appendLine(`Running runnable group ${groupNode.group.label}`);
  for (const item of groupNode.items) {
    await runRunnable(item, options);
  }
}

async function stopRunnableGroup(
  groupNode: Extract<RunnableTreeNode, { kind: 'group' }>,
  options: RunnableRuntimeOptions
): Promise<void> {
  for (const item of groupNode.items) {
    await stopRunnable(item, options, { quiet: true });
  }
}

async function restartRunnableGroup(
  groupNode: Extract<RunnableTreeNode, { kind: 'group' }>,
  options: RunnableRuntimeOptions
): Promise<void> {
  const runningItems = groupNode.items.filter(item => options.provider.getRuntimeState(item.id) !== 'stopped');
  if (runningItems.length === 0) {
    void vscode.window.showInformationMessage(`Go Bench: group "${groupNode.group.label}" has no running items.`);
    return;
  }

  for (const item of runningItems) {
    await restartRunnable(item, options);
  }
}

async function debugRunnableGroup(
  groupNode: Extract<RunnableTreeNode, { kind: 'group' }>,
  options: RunnableRuntimeOptions
): Promise<void> {
  if (groupNode.items.length === 0) {
    void vscode.window.showInformationMessage(`Go Bench: group "${groupNode.group.label}" has no runnable items.`);
    return;
  }

  options.output.appendLine('');
  options.output.appendLine(`Debugging runnable group ${groupNode.group.label}`);
  for (const item of groupNode.items) {
    await debugRunnable(item, options);
  }
}

async function removeGroupItems(
  groupNode: Extract<RunnableTreeNode, { kind: 'group' }>,
  options: RunnableRuntimeOptions
): Promise<void> {
  if (groupNode.items.length === 0) {
    void vscode.window.showInformationMessage(`Go Bench: group "${groupNode.group.label}" has no runnable items to remove.`);
    return;
  }

  const confirmed = await vscode.window.showWarningMessage(
    `Remove ${groupNode.items.length} runnable item(s) from group "${groupNode.group.label}"? Files on disk will not be deleted.`,
    { modal: true },
    'Remove Items'
  );
  if (confirmed !== 'Remove Items') {
    return;
  }

  for (const item of groupNode.items) {
    await stopRunnable(item, options, { quiet: true });
  }
  const ids = new Set(groupNode.items.map(item => item.id));
  await writeRunnableItems(readRunnableItems().filter(item => !ids.has(item.id)));
  options.provider.refresh();
}

async function removeGroup(
  groupNode: Extract<RunnableTreeNode, { kind: 'group' }>,
  options: { provider: GoBenchRunnablesProvider; output: vscode.OutputChannel }
): Promise<void> {
  const confirmed = await vscode.window.showWarningMessage(
    `Remove group "${groupNode.group.label}"? Its runnable items will stay in Run and Debug.`,
    { modal: true },
    'Remove Group'
  );
  if (confirmed !== 'Remove Group') {
    return;
  }

  const result = removeRunnableGroup(readRunnableGroups(), readRunnableItems(), groupNode.group.id);
  await writeRunnableGroups(result.groups);
  await writeRunnableItems(result.items);
  options.provider.refresh();
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
  options: RunnableRuntimeOptions
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
  await stopRunnable(item, options, { quiet: true });
  options.output.appendLine('');
  options.output.appendLine(`Running runnable ${item.label}`);
  options.output.appendLine(`$ ${command}`);

  const terminal = vscode.window.createTerminal({
    name: `${item.label}`,
    cwd,
    env: item.env
  });
  options.runningTerminals.set(item.id, terminal);
  options.provider.setRuntimeState(item.id, 'running');
  terminal.show();
  terminal.sendText(command);
}

async function stopRunnable(
  item: GoBenchRunnableItem,
  options: RunnableRuntimeOptions,
  control: { quiet?: boolean } = {}
): Promise<void> {
  const terminal = options.runningTerminals.get(item.id);
  const debugSession = options.debugSessions.get(item.id);
  const state = options.provider.getRuntimeState(item.id);
  if (!terminal && !debugSession && state !== 'debugging') {
    if (!control.quiet) {
      void vscode.window.showInformationMessage(`Go Bench: "${item.label}" is not running.`);
    }
    return;
  }

  if (terminal) {
    terminal.dispose();
    options.runningTerminals.delete(item.id);
  }
  if (debugSession) {
    await vscode.debug.stopDebugging(debugSession);
    options.debugSessions.delete(item.id);
    await closeDebugConsole();
  } else if (state === 'debugging') {
    await vscode.debug.stopDebugging();
    await closeDebugConsole();
  }
  options.pendingDebugSessionItems.delete(`Debug ${item.label}`);
  options.provider.clearRuntimeState(item.id);
  options.output.appendLine(`Stopped runnable ${item.label}`);
}

async function restartRunnable(item: GoBenchRunnableItem, options: RunnableRuntimeOptions): Promise<void> {
  const previousState = options.provider.getRuntimeState(item.id);
  await stopRunnable(item, options, { quiet: true });
  if (previousState === 'debugging') {
    await debugRunnable(item, options);
    return;
  }
  await runRunnable(item, options);
}

async function debugRunnable(
  item: GoBenchRunnableItem,
  options: RunnableRuntimeOptions
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
  await stopRunnable(item, options, { quiet: true });
  options.output.appendLine('');
  options.output.appendLine(`Debugging runnable ${item.label}`);
  options.output.appendLine(`Go Bench runnable debug configuration: ${JSON.stringify(configuration)}`);

  try {
    const vscodeWorkspaceFolder = vscode.workspace.workspaceFolders?.find(folder => folder.name === item.workspaceFolder);
    options.pendingDebugSessionItems.set(configuration.name, item.id);
    const started = await vscode.debug.startDebugging(vscodeWorkspaceFolder, configuration, {
      suppressDebugView: true
    });
    if (!started) {
      options.pendingDebugSessionItems.delete(configuration.name);
      void vscode.window.showErrorMessage('Go Bench: failed to start runnable debugging. Check the Go extension is installed.');
      return;
    }

    options.provider.setRuntimeState(item.id, 'debugging');
    options.provider.setDebugState(item.id, 'running');
    const session = await waitForRunnableDebugSession(item.id, options.debugSessions);
    await focusDebugConsole(session);
  } catch (error) {
    options.pendingDebugSessionItems.delete(configuration.name);
    options.provider.clearRuntimeState(item.id);
    options.output.appendLine(`Go Bench runnable debug failed: ${String(error)}`);
    void vscode.window.showErrorMessage(`Go Bench: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function runDebugControl(
  item: GoBenchRunnableItem,
  options: RunnableRuntimeOptions,
  action: RunnableDebugControlAction
): Promise<void> {
  if (options.provider.getRuntimeState(item.id) !== 'debugging') {
    return;
  }

  const session = options.debugSessions.get(item.id);
  if (!session) {
    return;
  }

  await executeDebugControlCommand(item, options, action);
}

async function focusDebugConsole(session?: vscode.DebugSession): Promise<void> {
  if (session) {
    selectActiveDebugSession(session);
  }
  try {
    await vscode.commands.executeCommand('workbench.debug.action.focusRepl');
  } catch {
    // 旧版或裁剪环境可能没有该内置命令；调试会话本身已经启动，聚焦失败不应影响状态同步。
  }
}

async function closeDebugConsole(): Promise<void> {
  try {
    await vscode.commands.executeCommand('workbench.action.closePanel');
  } catch {
    // 面板关闭只是停止调试后的清理体验，失败时保持 VSCode 默认行为。
  }
}

async function handleRunnableNodeClick(item: GoBenchRunnableItem, options: RunnableRuntimeOptions): Promise<void> {
  const now = Date.now();
  const previousClick = options.runnableNodeClicks.get(item.id) ?? 0;
  options.runnableNodeClicks.set(item.id, now);
  if (now - previousClick <= runnableDoubleClickMs) {
    options.runnableNodeClicks.delete(item.id);
    await revealRunnable(item);
    return;
  }

  await focusRunnableResult(item, options);
}

async function focusRunnableResult(item: GoBenchRunnableItem, options: RunnableRuntimeOptions): Promise<void> {
  const runtimeState = options.provider.getRuntimeState(item.id);
  if (runtimeState === 'running') {
    const terminal = options.runningTerminals.get(item.id);
    if (terminal) {
      terminal.show();
      return;
    }

    options.provider.clearRuntimeState(item.id);
    return;
  }

  if (runtimeState === 'debugging') {
    const session = options.debugSessions.get(item.id);
    if (session) {
      await refreshActiveDebugStackFrames(item.id, session, options.provider, options.output);
    }
    await focusDebugConsole(session);
  }
}

async function waitForRunnableDebugSession(
  itemId: string,
  debugSessions: ReadonlyMap<string, vscode.DebugSession>
): Promise<vscode.DebugSession | undefined> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1_000) {
    const session = debugSessions.get(itemId);
    if (session) {
      return session;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return debugSessions.get(itemId);
}

function selectActiveDebugSession(session: vscode.DebugSession): void {
  try {
    (vscode.debug as { activeDebugSession?: vscode.DebugSession }).activeDebugSession = session;
  } catch {
    // VSCode does not document setting the active debug session; focus still works for the current console.
  }
}

async function refreshActiveDebugStackFrames(
  itemId: string,
  session: vscode.DebugSession,
  provider: GoBenchRunnablesProvider,
  output: vscode.OutputChannel
): Promise<void> {
  const threadId = resolveDebugThreadId(vscode.debug.activeStackItem);
  if (threadId === undefined || resolveStackItemSession(vscode.debug.activeStackItem) !== session) {
    return;
  }

  provider.setDebugState(itemId, 'paused');
  provider.setDebugStackFrames(itemId, await readDebugStackFrames(itemId, session, threadId, output));
}

async function readDebugStackFrames(
  itemId: string,
  session: vscode.DebugSession,
  threadId: number,
  output: vscode.OutputChannel
): Promise<RunnableDebugStackFrame[]> {
  try {
    const response = await session.customRequest('stackTrace', { threadId, startFrame: 0, levels: 20 }) as DapStackTraceResponse;
    return (response.stackFrames ?? []).map(frame => ({
      itemId,
      id: frame.id,
      threadId,
      label: frame.name,
      detail: formatStackFrameDetail(frame.source?.path, frame.line),
      sourcePath: frame.source?.path,
      line: frame.line,
      column: frame.column
    }));
  } catch (error) {
    output.appendLine(`Go Bench: failed to read debug stack frames: ${String(error)}`);
    return [];
  }
}

async function executeDebugControlCommand(
  item: GoBenchRunnableItem,
  options: RunnableRuntimeOptions,
  action: RunnableDebugControlAction
): Promise<void> {
  try {
    if (action === 'continue') {
      options.resumedDebugStackSuppressions.set(item.id, Date.now() + 1_500);
    }
    await vscode.commands.executeCommand(formatDebugControlCommand(action));
    if (action === 'continue') {
      options.provider.setDebugState(item.id, 'running');
      options.provider.clearDebugStackFrames(item.id);
    }
  } catch (error) {
    if (action === 'continue') {
      options.resumedDebugStackSuppressions.delete(item.id);
    }
    options.output.appendLine(`Go Bench: debug control "${action}" failed: ${String(error)}`);
    void vscode.window.showErrorMessage(
      `Go Bench: failed to ${formatDebugControlTitle(action)} debug session. ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function formatDebugControlCommand(action: RunnableDebugControlAction): string {
  if (action === 'stepOver') {
    return 'workbench.action.debug.stepOver';
  }
  if (action === 'stepInto') {
    return 'workbench.action.debug.stepInto';
  }
  if (action === 'stepOut') {
    return 'workbench.action.debug.stepOut';
  }
  if (action === 'pause') {
    return 'workbench.action.debug.pause';
  }
  return 'workbench.action.debug.continue';
}

function formatDebugControlTitle(action: RunnableDebugControlAction): string {
  if (action === 'stepOver') {
    return 'step over';
  }
  if (action === 'stepInto') {
    return 'step into';
  }
  if (action === 'stepOut') {
    return 'step out';
  }
  return action;
}

async function openStackFrame(frame: RunnableDebugStackFrame): Promise<void> {
  if (!frame.sourcePath || !frame.line) {
    return;
  }

  const line = Math.max(frame.line - 1, 0);
  const column = Math.max((frame.column ?? 1) - 1, 0);
  const position = new vscode.Position(line, column);
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(frame.sourcePath));
  await vscode.window.showTextDocument(document, {
    preview: false,
    selection: new vscode.Range(position, position)
  });
}

async function revealRunnable(item: GoBenchRunnableItem): Promise<void> {
  const workspaceFolder = findWorkspaceFolderByName(item.workspaceFolder);
  if (!workspaceFolder) {
    void vscode.window.showErrorMessage(`Go Bench: workspace "${item.workspaceFolder}" is not open.`);
    return;
  }

  const uri = vscode.Uri.file(resolvePersistedPath(item.uri, workspaceFolder));
  const mainTarget = await resolveMainFunctionTarget(item, uri);
  if (mainTarget) {
    const document = await vscode.workspace.openTextDocument(mainTarget.uri);
    await vscode.window.showTextDocument(document, {
      selection: mainTarget.selection,
      preview: false
    });
    return;
  }

  if (item.kind === 'goFile') {
    await vscode.window.showTextDocument(uri);
    return;
  }
  await vscode.commands.executeCommand('revealFileInOS', uri);
}

async function resolveMainFunctionTarget(
  item: GoBenchRunnableItem,
  uri: vscode.Uri
): Promise<{ uri: vscode.Uri; selection: vscode.Range } | undefined> {
  if (item.kind === 'goFile') {
    return await findMainFunctionInFile(uri);
  }

  try {
    const entries = await vscode.workspace.fs.readDirectory(uri);
    for (const [name, type] of entries) {
      if (!name.endsWith('.go') || name.endsWith('_test.go') || (type & vscode.FileType.File) === 0) {
        continue;
      }
      const target = await findMainFunctionInFile(vscode.Uri.joinPath(uri, name));
      if (target) {
        return target;
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

async function findMainFunctionInFile(uri: vscode.Uri): Promise<{ uri: vscode.Uri; selection: vscode.Range } | undefined> {
  try {
    const document = await vscode.workspace.openTextDocument(uri);
    const match = /^([ \t]*)func\s+main\s*\(/m.exec(document.getText());
    if (!match) {
      return undefined;
    }
    const position = document.positionAt(match.index + (match[1]?.length ?? 0));
    return {
      uri,
      selection: new vscode.Range(position, position)
    };
  } catch {
    return undefined;
  }
}

type ScanRunnableCandidate = {
  uri: vscode.Uri;
  workspaceFolder: RunnableWorkspaceFolder;
  label: string;
  moduleName?: string;
  packageImportPath?: string;
  packageName: string;
};

async function readExecutableGoFileCandidate(uri: vscode.Uri): Promise<ScanRunnableCandidate | undefined> {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  if (!workspaceFolder) {
    return undefined;
  }

  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const text = Buffer.from(bytes).toString('utf8');
    if (!isExecutableGoFileContent(text)) {
      return undefined;
    }
    return {
      uri,
      workspaceFolder: toRunnableWorkspaceFolder(workspaceFolder),
      ...buildRunnableLabelInput(uri.fsPath, 'goFile'),
      packageName: parseGoPackageName(text) ?? 'main'
    };
  } catch {
    return undefined;
  }
}

async function readGoPackageName(uri: vscode.Uri, kind: GoBenchRunnableKind): Promise<string | undefined> {
  if (kind === 'goFile') {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      return parseGoPackageName(Buffer.from(bytes).toString('utf8'));
    } catch {
      return undefined;
    }
  }

  try {
    const entries = await vscode.workspace.fs.readDirectory(uri);
    for (const [name, type] of entries) {
      if (!name.endsWith('.go') || name.endsWith('_test.go') || (type & vscode.FileType.File) === 0) {
        continue;
      }
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(uri, name));
      const packageName = parseGoPackageName(Buffer.from(bytes).toString('utf8'));
      if (packageName) {
        return packageName;
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function buildRunnableLabelInput(
  fsPath: string,
  kind: GoBenchRunnableKind
): { label: string; moduleName?: string; packageImportPath?: string } {
  const packageDir = kind === 'goFile' ? dirname(fsPath) : fsPath;
  const moduleInfo = resolveGoModuleInfo(kind === 'goFile' ? fsPath : vscode.Uri.joinPath(vscode.Uri.file(fsPath), 'main.go').fsPath);
  if (!moduleInfo) {
    return { label: basename(fsPath) };
  }

  const relativePackageDir = relative(moduleInfo.dir, packageDir);
  const packageImportPath = relativePackageDir === '' ? '' : relativePackageDir.split(sep).join('/');
  const label = createRunnableItem({
    kind,
    path: fsPath,
    workspaceFolder: { name: moduleInfo.name, path: moduleInfo.dir },
    moduleName: moduleInfo.name,
    packageImportPath
  }).label;
  return {
    label,
    moduleName: moduleInfo.name,
    packageImportPath
  };
}

function rootToTreeNode(root: GoBenchRunnableTreeRoot): RunnableTreeNode {
  if (root.kind === 'group') {
    return {
      kind: 'group',
      group: root.group,
      items: root.items
    };
  }
  return {
    kind: 'runnable',
    item: root.item
  };
}

function formatRunnableContextValue(state: RunnableRuntimeState, debugState: RunnableDebugState): string {
  if (state === 'running') {
    return 'goBenchRunnableRunning';
  }
  if (state === 'debugging') {
    return debugState === 'paused' ? 'goBenchRunnableDebugPaused' : 'goBenchRunnableDebugging';
  }
  return 'goBenchRunnableStopped';
}

function getRunnableIcon(item: GoBenchRunnableItem, state: RunnableRuntimeState, debugState: RunnableDebugState): vscode.ThemeIcon {
  if (state === 'running') {
    return new vscode.ThemeIcon('play-circle', new vscode.ThemeColor('debugIcon.startForeground'));
  }
  if (state === 'debugging') {
    if (debugState === 'paused') {
      return new vscode.ThemeIcon('debug-pause', new vscode.ThemeColor('debugIcon.pauseForeground'));
    }
    return new vscode.ThemeIcon('debug-alt', new vscode.ThemeColor('debugIcon.continueForeground'));
  }
  return new vscode.ThemeIcon(item.kind === 'goFile' ? 'go-to-file' : 'package');
}

function parseDraggedRunnableIds(rawValue: string): string[] {
  try {
    const value = JSON.parse(rawValue) as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function resolveDropGroupId(target: RunnableTreeNode | undefined): string | undefined {
  if (target?.kind === 'group') {
    return target.group.id;
  }
  if (target?.kind === 'runnable') {
    return target.item.groupId;
  }
  return undefined;
}

function findRunnableIdByDebugSession(
  session: vscode.DebugSession,
  debugSessions: ReadonlyMap<string, vscode.DebugSession>
): string | undefined {
  for (const [id, debugSession] of debugSessions) {
    if (debugSession === session) {
      return id;
    }
  }
  return undefined;
}

function resolveStackItemSession(stackItem: unknown): vscode.DebugSession | undefined {
  if (stackItem && typeof stackItem === 'object' && 'session' in stackItem) {
    const session = (stackItem as { session?: unknown }).session;
    return isDebugSession(session) ? session : undefined;
  }
  return undefined;
}

function resolveDebugThreadId(source: unknown): number | undefined {
  if (!source || typeof source !== 'object') {
    return undefined;
  }
  const body = 'threadId' in source ? source : 'body' in source ? (source as { body?: unknown }).body : undefined;
  if (!body || typeof body !== 'object' || !('threadId' in body)) {
    return undefined;
  }
  const threadId = (body as { threadId?: unknown }).threadId;
  return typeof threadId === 'number' ? threadId : undefined;
}

function isDebugSession(value: unknown): value is vscode.DebugSession {
  return Boolean(value && typeof value === 'object' && 'customRequest' in value);
}

function formatStackFrameDetail(sourcePath: string | undefined, line: number | undefined): string | undefined {
  if (!sourcePath) {
    return line ? `line ${line}` : undefined;
  }
  const relativePath = vscode.workspace.asRelativePath(sourcePath, false);
  return line ? `${relativePath}:${line}` : relativePath;
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

function normalizeRunnableGroupCommandArgument(arg: RunnableTreeNode | undefined): Extract<RunnableTreeNode, { kind: 'group' }> | undefined {
  if (arg?.kind === 'group') {
    return arg;
  }
  return undefined;
}

function readRunnableItems(): GoBenchRunnableItem[] {
  return vscode.workspace.getConfiguration().get<GoBenchRunnableItem[]>(configurationKeys.runnableItems, []);
}

async function writeRunnableItems(items: GoBenchRunnableItem[]): Promise<void> {
  await vscode.workspace.getConfiguration().update(configurationKeys.runnableItems, items, vscode.ConfigurationTarget.Workspace);
}

function readRunnableGroups(): GoBenchRunnableGroup[] {
  return vscode.workspace.getConfiguration().get<GoBenchRunnableGroup[]>(configurationKeys.runnableGroups, []);
}

async function writeRunnableGroups(groups: GoBenchRunnableGroup[]): Promise<void> {
  await vscode.workspace.getConfiguration().update(configurationKeys.runnableGroups, groups, vscode.ConfigurationTarget.Workspace);
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
