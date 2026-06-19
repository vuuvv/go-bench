/**
 * CodeLens 运行结果写入 VSCode Test Results 的适配层。
 *
 * Test Results 只能通过 Testing API 的 `TestRun` 写入。CodeLens 不天然属于 Test Explorer，因此这里
 * 创建一个轻量 `TestController`，把每次 CodeLens Run 包装成临时测试节点，并复用 `go test -json`
 * 事件流写入 Test Results，避免用户只能在普通 output channel 中查看结果。
 */

import * as vscode from 'vscode';
import {
  buildGoTestJsonTestName,
  GoTestJsonStreamParser,
  type GoTestJsonEvent,
  type GoTestJsonStreamRecord
} from './goTestJson';
import {
  buildGoTestCommand,
  runGoTestTarget,
  type GoTestRunResult,
  type GoTestRunTarget,
  type RunnerOutput
} from './runner';
import type { SourceRange } from './parser';

const controllerId = 'go-bench.codeLensRuns';
const controllerLabel = 'Go Bench CodeLens Runs';

/** CodeLens Test Results reporter 依赖项。 */
export type GoBenchCodeLensTestResultsOptions = {
  /** 仍保留 output channel 作为辅助诊断入口，但 Test Results 是运行输出的主入口。 */
  output: RunnerOutput;
};

/** Test Results 中某个可运行目标的状态。 */
export type GoBenchTestResultStatus = 'running' | 'passed' | 'failed' | 'skipped';

/** Test Results 中一个临时测试节点的源码定位信息。 */
export type GoBenchRunTargetTestResultItem = {
  target: GoTestRunTarget;
  range?: SourceRange;
};

/** Test Results 中用于批量运行的树节点。 */
export type GoBenchRunTargetTestResultTree = {
  id: string;
  label: string;
  file?: string;
  range?: SourceRange;
  target?: GoTestRunTarget;
  children: GoBenchRunTargetTestResultTree[];
};

/** 单次 Test Results 运行的可选扩展信息。 */
export type GoBenchRunTargetTestResultsOptions = {
  /** 当前运行目标的源码定位范围。 */
  itemRange?: SourceRange;
  /** 当运行测试函数时，可传入可解析 table case，Test Results 会为它们创建子节点。 */
  childTargets?: GoTestRunTarget[];
  /** 带源码定位范围的 table case 子节点。优先于 `childTargets`。 */
  childItems?: GoBenchRunTargetTestResultItem[];
  /** 每个目标状态变化时通知调用方，侧边栏用它同步节点状态。 */
  onStatus?: (target: GoTestRunTarget, status: GoBenchTestResultStatus) => void;
};

/** 把 CodeLens 运行写入 VSCode Test Results 的 controller。 */
export class GoBenchCodeLensTestResults implements vscode.Disposable {
  private readonly controller = vscode.tests.createTestController(controllerId, controllerLabel);
  private readonly output: RunnerOutput;

  public constructor(options: GoBenchCodeLensTestResultsOptions) {
    this.output = options.output;
  }

  /** 运行一棵测试目标树，并在单个 Test Results run 中保留 group/function/case 层级。 */
  public async runTargetTree(
    tree: GoBenchRunTargetTestResultTree,
    workspaceRoot: string,
    options: Pick<GoBenchRunTargetTestResultsOptions, 'onStatus'> = {}
  ): Promise<GoTestRunResult> {
    const item = this.createTreeRunItem(tree);
    this.controller.items.add(item);

    const request = new vscode.TestRunRequest([item], undefined, undefined, undefined, false);
    const run = this.controller.createTestRun(request, `Run ${tree.label}`);
    const runItems = new Map<string, { item: vscode.TestItem; target: GoTestRunTarget }>();
    this.collectTreeRunItems(tree, item, runItems);
    const outputByTestName = new Map<string, string[]>();
    const completed = new Set<string>();
    const started = new Set<string>();
    const results: GoTestRunResult[] = [];

    for (const runItem of runItems.values()) {
      run.enqueued(runItem.item);
    }

    try {
      for (const functionRunItem of [...runItems.values()].filter(({ target }) => target.subtestPath.length === 0)) {
        const functionRunItems = createFunctionRunItemMap(functionRunItem, runItems);
        const parser = new GoTestJsonStreamParser();
        const handleRecord = (record: GoTestJsonStreamRecord): void => {
          if (record.kind === 'raw') {
            appendRunOutput(run, `${record.line}\n`);
            return;
          }
          this.applyGoTestJsonEvent(run, record.event, functionRunItems, started, completed, outputByTestName, options.onStatus);
        };

        this.ensureStarted(run, functionRunItem, started, options.onStatus);
        appendRunOutput(run, `$ ${buildGoTestCommand(functionRunItem.target, workspaceRoot, 'go', { json: true })}\n`);

        const result = await runGoTestTarget(functionRunItem.target, {
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
            appendRunOutput(run, chunk);
            this.output.append(chunk);
          }
        });
        results.push(result);

        for (const record of parser.flush()) {
          handleRecord(record);
        }

        for (const [testName, runItem] of functionRunItems) {
          if (completed.has(testName)) {
            continue;
          }
          this.ensureStarted(run, runItem, started, options.onStatus);
          if (result.success) {
            run.passed(runItem.item);
            options.onStatus?.(runItem.target, 'passed');
          } else {
            run.failed(runItem.item, createFailureMessage(runItem, testName, outputByTestName, result.code));
            options.onStatus?.(runItem.target, 'failed');
          }
          completed.add(testName);
        }
      }

      return mergeRunResults(results);
    } catch (error) {
      const message = new vscode.TestMessage(`Go Bench: ${error instanceof Error ? error.message : String(error)}`);
      run.failed(item, message);
      for (const runItem of runItems.values()) {
        options.onStatus?.(runItem.target, 'failed');
      }
      throw error;
    } finally {
      run.end();
    }
  }

  /** 运行一个 CodeLens 目标，并将 stdout、stderr 和最终状态写入 Test Results。 */
  public async runTarget(
    target: GoTestRunTarget,
    workspaceRoot: string,
    options: GoBenchRunTargetTestResultsOptions = {}
  ): Promise<GoTestRunResult> {
    const childItems = options.childItems ?? (options.childTargets ?? []).map(childTarget => ({ target: childTarget }));
    const item = this.createRunItem({ target, range: options.itemRange }, childItems);
    this.controller.items.add(item);

    const request = new vscode.TestRunRequest([item], undefined, undefined, undefined, false);
    const run = this.controller.createTestRun(request, `Run ${target.label}`);
    const parser = new GoTestJsonStreamParser();
    const runItems = this.createRunItemMap(target, item, childItems);
    const outputByTestName = new Map<string, string[]>();
    const completed = new Set<string>();
    const started = new Set<string>();

    const handleRecord = (record: GoTestJsonStreamRecord): void => {
      if (record.kind === 'raw') {
        appendRunOutput(run, `${record.line}\n`);
        return;
      }
      this.applyGoTestJsonEvent(run, record.event, runItems, started, completed, outputByTestName, options.onStatus);
    };

    for (const runItem of runItems.values()) {
      run.enqueued(runItem.item);
    }
    this.ensureStarted(run, runItems.get(buildGoTestJsonTestName(target)), started, options.onStatus);
    appendRunOutput(run, `$ ${buildGoTestCommand(target, workspaceRoot, 'go', { json: true })}\n`);

    try {
      const result = await runGoTestTarget(target, {
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
          appendRunOutput(run, chunk);
          this.output.append(chunk);
        }
      });

      for (const record of parser.flush()) {
        handleRecord(record);
      }

      for (const [testName, runItem] of runItems) {
        if (completed.has(testName)) {
          continue;
        }
        this.ensureStarted(run, runItem, started, options.onStatus);
        if (result.success) {
          run.passed(runItem.item);
          options.onStatus?.(runItem.target, 'passed');
        } else {
          run.failed(runItem.item, createFailureMessage(runItem, testName, outputByTestName, result.code));
          options.onStatus?.(runItem.target, 'failed');
        }
      }

      return result;
    } catch (error) {
      run.failed(item, new vscode.TestMessage(`Go Bench: ${error instanceof Error ? error.message : String(error)}`));
      options.onStatus?.(target, 'failed');
      throw error;
    } finally {
      run.end();
    }
  }

  /** 释放 CodeLens 运行结果 controller。 */
  public dispose(): void {
    this.controller.dispose();
  }

  private createRunItem(
    runItem: GoBenchRunTargetTestResultItem,
    childItems: readonly GoBenchRunTargetTestResultItem[] = []
  ): vscode.TestItem {
    const target = runItem.target;
    const id = ['go-bench-codelens', target.file, target.testName, ...target.subtestPath].map(encodeURIComponent).join('/');
    this.controller.items.delete(id);
    const item = this.controller.createTestItem(id, target.label, vscode.Uri.file(target.file));
    item.range = toVsCodeRange(runItem.range);
    for (const childItem of childItems) {
      item.children.add(this.createChildRunItem(childItem));
    }
    return item;
  }

  private createTreeRunItem(tree: GoBenchRunTargetTestResultTree): vscode.TestItem {
    const item = this.controller.createTestItem(
      createTreeRunItemId(tree),
      tree.label,
      tree.file ? vscode.Uri.file(tree.file) : undefined
    );
    item.range = toVsCodeRange(tree.range);
    for (const child of tree.children) {
      item.children.add(this.createTreeRunItem(child));
    }
    return item;
  }

  private collectTreeRunItems(
    tree: GoBenchRunTargetTestResultTree,
    item: vscode.TestItem,
    items: Map<string, { item: vscode.TestItem; target: GoTestRunTarget }>
  ): void {
    if (tree.target) {
      items.set(buildGoTestJsonTestName(tree.target), { item, target: tree.target });
    }

    for (const childTree of tree.children) {
      const child = item.children.get(createTreeRunItemId(childTree));
      if (child) {
        this.collectTreeRunItems(childTree, child, items);
      }
    }
  }

  private createChildRunItem(runItem: GoBenchRunTargetTestResultItem): vscode.TestItem {
    const target = runItem.target;
    const id = ['go-bench-codelens', target.file, target.testName, ...target.subtestPath].map(encodeURIComponent).join('/');
    const item = this.controller.createTestItem(id, target.subtestPath.at(-1) ?? target.label, vscode.Uri.file(target.file));
    item.range = toVsCodeRange(runItem.range);
    return item;
  }

  private createRunItemMap(
    target: GoTestRunTarget,
    item: vscode.TestItem,
    childItems: readonly GoBenchRunTargetTestResultItem[]
  ): Map<string, { item: vscode.TestItem; target: GoTestRunTarget }> {
    const items = new Map<string, { item: vscode.TestItem; target: GoTestRunTarget }>();
    items.set(buildGoTestJsonTestName(target), { item, target });
    for (const { target: childTarget } of childItems) {
      const child = item.children.get(['go-bench-codelens', childTarget.file, childTarget.testName, ...childTarget.subtestPath].map(encodeURIComponent).join('/'));
      if (child) {
        items.set(buildGoTestJsonTestName(childTarget), { item: child, target: childTarget });
      }
    }
    return items;
  }

  private applyGoTestJsonEvent(
    run: vscode.TestRun,
    event: GoTestJsonEvent,
    runItems: Map<string, { item: vscode.TestItem; target: GoTestRunTarget }>,
    started: Set<string>,
    completed: Set<string>,
    outputByTestName: Map<string, string[]>,
    onStatus: ((target: GoTestRunTarget, status: GoBenchTestResultStatus) => void) | undefined
  ): void {
    const runItem = event.Test ? runItems.get(event.Test) : undefined;
    if (event.Action === 'output') {
      const output = event.Output ?? '';
      if (output.length > 0) {
        appendRunOutput(run, output, runItem?.item);
        this.output.append(output);
        if (event.Test) {
          const existing = outputByTestName.get(event.Test) ?? [];
          existing.push(output);
          outputByTestName.set(event.Test, existing);
        }
      }
      return;
    }

    if (!event.Test || !runItem) {
      return;
    }

    if (event.Action === 'run' || event.Action === 'cont') {
      this.ensureStarted(run, runItem, started, onStatus);
      return;
    }

    if (event.Action === 'pass') {
      this.ensureStarted(run, runItem, started, onStatus);
      run.passed(runItem.item, toDurationMs(event.Elapsed));
      completed.add(event.Test);
      onStatus?.(runItem.target, 'passed');
      return;
    }

    if (event.Action === 'skip') {
      this.ensureStarted(run, runItem, started, onStatus);
      run.skipped(runItem.item);
      completed.add(event.Test);
      onStatus?.(runItem.target, 'skipped');
      return;
    }

    if (event.Action === 'fail') {
      this.ensureStarted(run, runItem, started, onStatus);
      run.failed(runItem.item, createFailureMessageFromOutput(runItem.item, event.Test, outputByTestName), toDurationMs(event.Elapsed));
      completed.add(event.Test);
      onStatus?.(runItem.target, 'failed');
    }
  }

  private ensureStarted(
    run: vscode.TestRun,
    runItem: { item: vscode.TestItem; target: GoTestRunTarget } | undefined,
    started: Set<string>,
    onStatus: ((target: GoTestRunTarget, status: GoBenchTestResultStatus) => void) | undefined
  ): void {
    if (!runItem || started.has(runItem.item.id)) {
      return;
    }
    run.started(runItem.item);
    started.add(runItem.item.id);
    onStatus?.(runItem.target, 'running');
  }
}

function createFailureMessage(
  runItem: { item: vscode.TestItem; target: GoTestRunTarget },
  expectedTestName: string,
  outputByTestName: Map<string, string[]>,
  code: number | null
): vscode.TestMessage {
  const output = (outputByTestName.get(expectedTestName) ?? []).join('').trim();
  const message =
    output.length > 0 ? output : `go test failed for ${runItem.target.label} with exit code ${code ?? 'unknown'}.`;
  return createLocatedTestMessage(message, runItem.item);
}

function createFailureMessageFromOutput(
  item: vscode.TestItem,
  expectedTestName: string,
  outputByTestName: Map<string, string[]>
): vscode.TestMessage {
  const output = (outputByTestName.get(expectedTestName) ?? []).join('').trim();
  return createLocatedTestMessage(output.length > 0 ? output : 'go test failed.', item);
}

function createLocatedTestMessage(message: string, item: vscode.TestItem): vscode.TestMessage {
  const testMessage = new vscode.TestMessage(message);
  if (item.uri && item.range) {
    testMessage.location = new vscode.Location(item.uri, item.range);
  }
  return testMessage;
}

function appendRunOutput(run: vscode.TestRun, output: string, item?: vscode.TestItem): void {
  run.appendOutput(output.replace(/\r?\n/g, '\r\n'), undefined, item);
}

function createTreeRunItemId(tree: GoBenchRunTargetTestResultTree): string {
  return ['go-bench-tree-run', tree.id].map(encodeURIComponent).join('/');
}

function createFunctionRunItemMap(
  root: { item: vscode.TestItem; target: GoTestRunTarget },
  allItems: Map<string, { item: vscode.TestItem; target: GoTestRunTarget }>
): Map<string, { item: vscode.TestItem; target: GoTestRunTarget }> {
  const items = new Map<string, { item: vscode.TestItem; target: GoTestRunTarget }>();
  for (const [testName, runItem] of allItems) {
    if (isSameFunctionRun(runItem.target, root.target)) {
      items.set(testName, runItem);
    }
  }
  return items;
}

function isSameFunctionRun(left: GoTestRunTarget, right: GoTestRunTarget): boolean {
  return left.file === right.file && left.testName === right.testName;
}

function mergeRunResults(results: readonly GoTestRunResult[]): GoTestRunResult {
  const failingResult = results.find(result => !result.success);
  return {
    code: failingResult?.code ?? (results.length > 0 ? 0 : null),
    success: results.length > 0 && !failingResult,
    stdout: results.map(result => result.stdout).join(''),
    stderr: results.map(result => result.stderr).join('')
  };
}

function toDurationMs(elapsed: number | undefined): number | undefined {
  if (typeof elapsed !== 'number') {
    return undefined;
  }
  return Math.max(0, Math.round(elapsed * 1000));
}

function toVsCodeRange(range: SourceRange | undefined): vscode.Range | undefined {
  if (!range) {
    return undefined;
  }
  return new vscode.Range(range.start.line, range.start.character, range.end.line, range.end.character);
}
