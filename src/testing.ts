/**
 * VSCode Testing API 实验原型。
 *
 * 该模块把 parser 识别出的 Go test/table case 映射到 VSCode Test Explorer。它是里程碑 5 的评估
 * 原型，默认由配置关闭：v0.1 仍以 CodeLens 作为主入口，Testing API 只用于比较测试树 UX、复用
 * runner 目标模型，并验证后续接入成本。
 */

import * as vscode from 'vscode';
import { parserConfigCacheKey } from './codelensCache';
import { readTableTestConfigFromWorkspace } from './codelens';
import {
  buildGoTestJsonTestName,
  GoTestJsonStreamParser,
  type GoTestJsonEvent,
  type GoTestJsonStreamRecord
} from './goTestJson';
import { buildGoTestDebugConfiguration, type GoTestDebugConfiguration } from './debugger';
import { GoHelperParser, isGoTestFile } from './parser';
import type { GoTestFileParseResult, GoTestParser, SourceRange } from './parser';
import { runGoTestTarget, type GoTestRunTarget } from './runner';
import {
  createGoTestFileNodeId,
  createGoTestTreeNodes,
  type GoTestTreeNode,
  type GoTestTreeNodeKind
} from './testingTargets';
import type { TableTestConfig } from './tableTestConfig';

const controllerId = 'go-bench.tableTests';
const controllerLabel = 'Go Bench Table Tests';
const goTestFilePattern = '**/*_test.go';
const ignoredTestFilePattern = '**/{.git,node_modules,out}/**';

/** Testing API 原型依赖项，测试或后续集成可以替换 parser/config。 */
export type GoBenchTestingApiPrototypeOptions = {
  /** VSCode output channel，用于复用 runner 输出和记录 parser 诊断。 */
  output: vscode.OutputChannel;
  /** Go 测试文件 parser，默认使用 Go helper。 */
  parser?: GoTestParser;
  /** 读取当前配置的函数，默认从 VSCode workspace configuration 读取。 */
  getConfig?: () => TableTestConfig;
};

type RegisteredTestItem = {
  item: vscode.TestItem;
  target: GoTestRunTarget;
  kind: Extract<GoTestTreeNodeKind, 'function' | 'case'>;
};

type TestRunGroup = {
  root: RegisteredTestItem;
  items: RegisteredTestItem[];
};

/**
 * 管理实验性 `TestController` 的生命周期。
 *
 * 开关关闭时不创建 controller，避免 Test Explorer 出现空的 Go Bench 树；开关打开后会刷新当前已打开
 * 的 Go 测试文件，并在后续文档事件中增量更新。
 */
export class GoBenchTestingApiPrototypeManager implements vscode.Disposable {
  private prototype: GoBenchTestingApiPrototype | undefined;

  public constructor(private readonly options: GoBenchTestingApiPrototypeOptions) {}

  /** 按配置启用或停用 Testing API 原型。 */
  public setEnabled(enabled: boolean): void {
    if (enabled && !this.prototype) {
      this.prototype = new GoBenchTestingApiPrototype(this.options);
      for (const document of vscode.workspace.textDocuments) {
        this.refreshDocument(document);
      }
      return;
    }

    if (!enabled && this.prototype) {
      this.prototype.dispose();
      this.prototype = undefined;
    }
  }

  /** 刷新单个文档对应的测试树；关闭时忽略事件。 */
  public refreshDocument(document: vscode.TextDocument): void {
    void this.prototype?.refreshDocument(document);
  }

  /** 打开或复用指定 Go 测试文件，并只刷新该文件对应的测试树节点；关闭时返回 false。 */
  public async refreshFile(file: string): Promise<boolean> {
    if (!this.prototype) {
      return false;
    }
    return await this.prototype.refreshFile(file);
  }

  /** 扫描 workspace 中所有 Go 测试文件并重建实验测试树；关闭时返回 0。 */
  public async refreshWorkspace(): Promise<number> {
    if (!this.prototype) {
      return 0;
    }
    return await this.prototype.refreshWorkspace();
  }

  /** 释放当前 controller。 */
  public dispose(): void {
    this.prototype?.dispose();
    this.prototype = undefined;
  }
}

class GoBenchTestingApiPrototype implements vscode.Disposable {
  private readonly controller: vscode.TestController;
  private readonly parser: GoTestParser;
  private readonly getConfig: () => TableTestConfig;
  private readonly output: vscode.OutputChannel;
  private readonly registeredItems = new Map<string, RegisteredTestItem>();
  private readonly testItems = new Map<string, vscode.TestItem>();
  private readonly disposables: vscode.Disposable[] = [];

  public constructor(options: GoBenchTestingApiPrototypeOptions) {
    this.output = options.output;
    this.parser = options.parser ?? new GoHelperParser();
    this.getConfig = options.getConfig ?? readTableTestConfigFromWorkspace;
    this.controller = vscode.tests.createTestController(controllerId, controllerLabel);
    this.controller.refreshHandler = async (token): Promise<void> => {
      await this.refreshWorkspace(token);
    };
    this.disposables.push(this.controller);
    this.disposables.push(
      this.controller.createRunProfile('Run', vscode.TestRunProfileKind.Run, request => {
        void this.runTests(request);
      })
    );
    this.disposables.push(
      this.controller.createRunProfile('Debug', vscode.TestRunProfileKind.Debug, request => {
        void this.debugTests(request);
      })
    );
  }

  /**
   * 解析文档并重建对应文件的测试树。
   *
   * 原型阶段按文件整棵替换，逻辑简单且便于评估；后续若默认启用 Testing API，再考虑更细粒度 diff。
   */
  public async refreshDocument(document: vscode.TextDocument): Promise<void> {
    const file = document.uri.fsPath;
    if (!isGoTestFile(file)) {
      return;
    }

    const config = this.getConfig();
    if (!config.enabled || !config.testingApiEnabled) {
      this.removeFileItems(file);
      return;
    }

    try {
      const parser =
        this.parser instanceof GoHelperParser ? new GoHelperParser({ nameFields: config.nameFields }) : this.parser;
      const parseResult = await parser.parseTestFile(file, document.getText());
      this.outputDiagnostics(file, parseResult);
      this.replaceFileItems(document.uri, file, createGoTestTreeNodes(parseResult, config, {
        workspaceRoot: vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath
      }));
    } catch (error) {
      this.output.appendLine(`Go Bench Testing API parse failed for ${file}: ${String(error)}`);
      this.removeFileItems(file);
    }
  }

  /** 只刷新一个 Go 测试文件，供顶部 CodeLens 和命令面板入口复用。 */
  public async refreshFile(file: string): Promise<boolean> {
    if (!isGoTestFile(file)) {
      return false;
    }

    const document = await openWorkspaceDocument(vscode.Uri.file(file));
    await this.refreshDocument(document);
    this.output.appendLine(`Go Bench Testing API refresh: refreshed current file ${file}.`);
    return true;
  }

  /**
   * 重新扫描整个 workspace 并刷新测试树。
   *
   * 这个入口同时服务命令面板命令和 Test Explorer 的 refresh 按钮。扫描会读取未打开的 `_test.go`
   * 文件；如果某个文件已经在编辑器中打开，则优先使用内存中的未保存文本，避免测试树落后于用户编辑。
   */
  public async refreshWorkspace(token?: vscode.CancellationToken): Promise<number> {
    const config = this.getConfig();
    if (!config.enabled || !config.testingApiEnabled) {
      this.clearAllItems();
      return 0;
    }

    const uris = await vscode.workspace.findFiles(goTestFilePattern, ignoredTestFilePattern);
    this.output.appendLine(`Go Bench Testing API refresh: scanning ${uris.length} Go test file(s).`);
    this.clearAllItems();

    let refreshed = 0;
    for (const uri of uris) {
      if (token?.isCancellationRequested) {
        break;
      }
      const document = await openWorkspaceDocument(uri);
      await this.refreshDocument(document);
      refreshed++;
    }

    this.output.appendLine(`Go Bench Testing API refresh: refreshed ${refreshed} Go test file(s).`);
    return refreshed;
  }

  public dispose(): void {
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
    this.registeredItems.clear();
    this.testItems.clear();
  }

  private replaceFileItems(uri: vscode.Uri, file: string, nodes: GoTestTreeNode[]): void {
    this.removeFileItems(file);
    for (const node of nodes) {
      this.mergeTestItem(uri, node);
    }
  }

  private createTestItem(uri: vscode.Uri, node: GoTestTreeNode): vscode.TestItem {
    const itemUri = node.file ? vscode.Uri.file(node.file) : uri;
    const item = this.controller.createTestItem(node.id, node.label, itemUri);
    if (node.range) {
      item.range = toVsCodeRange(node.range);
    }
    this.testItems.set(node.id, item);
    if (node.runTarget && (node.kind === 'function' || node.kind === 'case')) {
      this.registeredItems.set(node.id, { item, target: node.runTarget, kind: node.kind });
    }

    for (const child of node.children) {
      item.children.add(this.createTestItem(uri, child));
    }

    return item;
  }

  private mergeTestItem(uri: vscode.Uri, node: GoTestTreeNode): vscode.TestItem {
    const existing = this.testItems.get(node.id);
    if (!existing) {
      const item = this.createTestItem(uri, node);
      this.controller.items.add(item);
      return item;
    }

    for (const child of node.children) {
      existing.children.add(this.createTestItem(uri, child));
    }
    return existing;
  }

  private removeFileItems(file: string): void {
    const fileItem = this.testItems.get(createGoTestFileNodeId(file));
    if (!fileItem) {
      return;
    }

    const parent = fileItem.parent;
    this.deleteItemTree(fileItem);
    parent?.children.delete(fileItem.id);
    this.pruneEmptyAncestors(parent);
  }

  private clearAllItems(): void {
    const itemIds = [...this.controller.items].map(([id]) => id);
    for (const id of itemIds) {
      this.controller.items.delete(id);
    }
    this.registeredItems.clear();
    this.testItems.clear();
  }

  private async runTests(request: vscode.TestRunRequest): Promise<void> {
    const run = this.controller.createTestRun(request);
    const groups = this.collectRequestedRunGroups(request);

    for (const group of groups) {
      for (const registered of group.items) {
        run.enqueued(registered.item);
      }
    }

    for (const group of groups) {
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(group.root.target.file));
      if (!workspaceFolder) {
        const message = new vscode.TestMessage('Go Bench: cannot determine workspace folder for this Go test file.');
        for (const registered of group.items) {
          this.ensureStarted(run, registered, new Set());
          run.failed(registered.item, message);
        }
        continue;
      }

      try {
        await this.runGroupWithJsonEvents(run, group, workspaceFolder.uri.fsPath);
      } catch (error) {
        const message = new vscode.TestMessage(`Go Bench: ${error instanceof Error ? error.message : String(error)}`);
        for (const registered of group.items) {
          this.ensureStarted(run, registered, new Set());
          run.failed(registered.item, message);
        }
      }
    }

    run.end();
  }

  private async debugTests(request: vscode.TestRunRequest): Promise<void> {
    const groups = this.collectRequestedRunGroups(request);

    for (const group of groups) {
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(group.root.target.file));
      if (!workspaceFolder) {
        void vscode.window.showErrorMessage('Go Bench: cannot determine workspace folder for this Go test file.');
        continue;
      }

      const configuration = buildGoTestDebugConfiguration(group.root.target);
      this.output.appendLine('');
      this.output.appendLine(`Go Bench Testing API debug: ${group.root.target.label}`);
      this.output.appendLine(`Go Bench debug configuration: ${JSON.stringify(configuration)}`);
      const started = await startDebuggingAndVerify(workspaceFolder, configuration, group.root.target.label);
      if (!started) {
        void vscode.window.showErrorMessage(`Go Bench: failed to start debugging ${group.root.target.label}.`);
      }
    }
  }

  private async runGroupWithJsonEvents(
    run: vscode.TestRun,
    group: TestRunGroup,
    workspaceRoot: string
  ): Promise<void> {
    const parser = new GoTestJsonStreamParser();
    const itemByGoTestName = new Map(group.items.map(registered => [buildGoTestJsonTestName(registered.target), registered]));
    const started = new Set<string>();
    const completed = new Set<string>();
    const outputByGoTestName = new Map<string, string[]>();

    const handleRecord = (record: GoTestJsonStreamRecord): void => {
      if (record.kind === 'raw') {
        this.appendRunOutput(run, `${record.line}\n`);
        return;
      }
      this.applyGoTestJsonEvent(run, record.event, itemByGoTestName, started, completed, outputByGoTestName);
    };

    const result = await runGoTestTarget(group.root.target, {
      workspaceRoot,
      output: this.output,
      json: true,
      writeProcessOutput: false,
      onStdout: chunk => {
        for (const record of parser.push(chunk)) {
          handleRecord(record);
        }
      },
      onStderr: chunk => {
        this.appendRunOutput(run, chunk);
      }
    });

    for (const record of parser.flush()) {
      handleRecord(record);
    }

    if (result.stderr.length > 0) {
      this.output.append(result.stderr);
    }

    if (!result.success && ![...completed].some(id => group.items.some(registered => registered.item.id === id))) {
      this.ensureStarted(run, group.root, started);
      run.failed(
        group.root.item,
        new vscode.TestMessage(`go test failed with exit code ${result.code ?? 'unknown'}.`)
      );
      completed.add(group.root.item.id);
    }

    for (const registered of group.items) {
      if (completed.has(registered.item.id)) {
        continue;
      }
      this.ensureStarted(run, registered, started);
      if (result.success) {
        run.passed(registered.item);
      } else {
        run.failed(
          registered.item,
          new vscode.TestMessage(`go test finished without a mapped result for ${registered.target.label}.`)
        );
      }
    }
  }

  private applyGoTestJsonEvent(
    run: vscode.TestRun,
    event: GoTestJsonEvent,
    itemByGoTestName: Map<string, RegisteredTestItem>,
    started: Set<string>,
    completed: Set<string>,
    outputByGoTestName: Map<string, string[]>
  ): void {
    const registered = event.Test ? itemByGoTestName.get(event.Test) : undefined;

    if (event.Action === 'output') {
      const output = event.Output ?? '';
      if (output.length === 0) {
        return;
      }
      this.appendRunOutput(run, output, registered?.item);
      this.output.append(output);
      if (event.Test) {
        const existing = outputByGoTestName.get(event.Test) ?? [];
        existing.push(output);
        outputByGoTestName.set(event.Test, existing);
      }
      return;
    }

    if (!registered) {
      return;
    }

    if (event.Action === 'run' || event.Action === 'cont') {
      this.ensureStarted(run, registered, started);
      return;
    }

    if (event.Action === 'pass') {
      this.ensureStarted(run, registered, started);
      run.passed(registered.item, toDurationMs(event.Elapsed));
      completed.add(registered.item.id);
      return;
    }

    if (event.Action === 'skip') {
      this.ensureStarted(run, registered, started);
      run.skipped(registered.item);
      completed.add(registered.item.id);
      return;
    }

    if (event.Action === 'fail') {
      this.ensureStarted(run, registered, started);
      run.failed(registered.item, this.createFailureMessage(registered, event, outputByGoTestName), toDurationMs(event.Elapsed));
      completed.add(registered.item.id);
    }
  }

  private createFailureMessage(
    registered: RegisteredTestItem,
    event: GoTestJsonEvent,
    outputByGoTestName: Map<string, string[]>
  ): vscode.TestMessage {
    const output = event.Test ? (outputByGoTestName.get(event.Test) ?? []).join('').trim() : '';
    const message = output.length > 0 ? output : `go test failed for ${registered.target.label}.`;
    return new vscode.TestMessage(message);
  }

  private ensureStarted(run: vscode.TestRun, registered: RegisteredTestItem, started: Set<string>): void {
    if (started.has(registered.item.id)) {
      return;
    }
    run.started(registered.item);
    started.add(registered.item.id);
  }

  private appendRunOutput(run: vscode.TestRun, output: string, item?: vscode.TestItem): void {
    run.appendOutput(output.replace(/\r?\n/g, '\r\n'), undefined, item);
  }

  private collectRequestedRunGroups(request: vscode.TestRunRequest): TestRunGroup[] {
    const include = request.include ?? [...this.controller.items].map(([, item]) => item);
    const includeIds = new Set(include.map(item => item.id));
    const excluded = new Set((request.exclude ?? []).map(item => item.id));
    const collected = new Map<string, RegisteredTestItem>();

    for (const item of include) {
      if (excluded.has(item.id) || hasIncludedAncestor(item, includeIds)) {
        continue;
      }
      this.collectItemAndChildren(item, excluded, collected);
    }

    const groups = new Map<string, TestRunGroup>();
    const executableItems = [...collected.values()];
    const groupedIds = new Set<string>();
    for (const registered of executableItems) {
      if (registered.kind !== 'function') {
        continue;
      }
      const items = new Map<string, RegisteredTestItem>();
      this.collectItemAndChildren(registered.item, excluded, items);
      for (const id of [...items.keys()]) {
        if (!collected.has(id)) {
          items.delete(id);
        }
      }
      groups.set(registered.item.id, {
        root: registered,
        items: [...items.values()]
      });
      for (const id of items.keys()) {
        groupedIds.add(id);
      }
    }

    for (const registered of executableItems) {
      if (registered.kind !== 'case' || groupedIds.has(registered.item.id)) {
        continue;
      }
      groups.set(registered.item.id, {
        root: registered,
        items: [registered]
      });
    }

    return [...groups.values()];
  }

  private collectItemAndChildren(
    item: vscode.TestItem,
    excluded: Set<string>,
    collected: Map<string, RegisteredTestItem>
  ): void {
    if (excluded.has(item.id)) {
      return;
    }

    const registered = this.registeredItems.get(item.id);
    if (registered) {
      collected.set(item.id, registered);
    }

    item.children.forEach(child => {
      this.collectItemAndChildren(child, excluded, collected);
    });
  }

  private outputDiagnostics(file: string, parseResult: GoTestFileParseResult): void {
    if (parseResult.diagnostics.length === 0) {
      return;
    }

    const configKey = parserConfigCacheKey(this.getConfig());
    for (const diagnostic of parseResult.diagnostics) {
      const position =
        typeof diagnostic.line === 'number'
          ? `:${diagnostic.line + 1}:${(diagnostic.character ?? 0) + 1}`
          : '';
      this.output.appendLine(`Go Bench Testing API diagnostic ${file}${position} (${configKey}): ${diagnostic.message}`);
    }
  }

  private deleteItemTree(item: vscode.TestItem): void {
    item.children.forEach(child => {
      this.deleteItemTree(child);
    });
    this.registeredItems.delete(item.id);
    this.testItems.delete(item.id);
  }

  private pruneEmptyAncestors(item: vscode.TestItem | undefined): void {
    let current = item;
    while (current && current.children.size === 0 && !this.registeredItems.has(current.id)) {
      const parent = current.parent;
      this.deleteItemTree(current);
      if (parent) {
        parent.children.delete(current.id);
      } else {
        this.controller.items.delete(current.id);
      }
      current = parent;
    }
  }
}

async function openWorkspaceDocument(uri: vscode.Uri): Promise<vscode.TextDocument> {
  const existing = vscode.workspace.textDocuments.find(document => document.uri.fsPath === uri.fsPath);
  return existing ?? (await vscode.workspace.openTextDocument(uri));
}

function toVsCodeRange(range: SourceRange): vscode.Range {
  return new vscode.Range(
    new vscode.Position(range.start.line, range.start.character),
    new vscode.Position(range.end.line, range.end.character)
  );
}

function hasIncludedAncestor(item: vscode.TestItem, includeIds: ReadonlySet<string>): boolean {
  let parent = item.parent;
  while (parent) {
    if (includeIds.has(parent.id)) {
      return true;
    }
    parent = parent.parent;
  }
  return false;
}

function toDurationMs(elapsed: number | undefined): number | undefined {
  if (typeof elapsed !== 'number') {
    return undefined;
  }
  return Math.max(0, Math.round(elapsed * 1000));
}

async function startDebuggingAndVerify(
  workspaceFolder: vscode.WorkspaceFolder,
  configuration: GoTestDebugConfiguration,
  label: string
): Promise<boolean> {
  let matchedSession = false;
  const sessionStarted = new Promise<boolean>(resolve => {
    const timer = setTimeout(() => {
      subscription.dispose();
      resolve(matchedSession);
    }, 2_000);
    const subscription = vscode.debug.onDidStartDebugSession(session => {
      if (session.configuration.name !== configuration.name) {
        return;
      }
      matchedSession = true;
      clearTimeout(timer);
      subscription.dispose();
      resolve(true);
    });
  });

  const accepted = await vscode.debug.startDebugging(workspaceFolder, configuration);
  if (!accepted) {
    return false;
  }

  const observedSession = await sessionStarted;
  if (!observedSession) {
    void vscode.window.showWarningMessage(`Go Bench: debug request was accepted but no debug session started for ${label}.`);
  }
  return true;
}
