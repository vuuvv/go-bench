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

const controllerId = 'go-bench.codeLensRuns';
const controllerLabel = 'Go Bench CodeLens Runs';

/** CodeLens Test Results reporter 依赖项。 */
export type GoBenchCodeLensTestResultsOptions = {
  /** 仍保留 output channel 作为辅助诊断入口，但 Test Results 是运行输出的主入口。 */
  output: RunnerOutput;
};

/** 把 CodeLens 运行写入 VSCode Test Results 的 controller。 */
export class GoBenchCodeLensTestResults implements vscode.Disposable {
  private readonly controller = vscode.tests.createTestController(controllerId, controllerLabel);
  private readonly output: RunnerOutput;

  public constructor(options: GoBenchCodeLensTestResultsOptions) {
    this.output = options.output;
  }

  /** 运行一个 CodeLens 目标，并将 stdout、stderr 和最终状态写入 Test Results。 */
  public async runTarget(target: GoTestRunTarget, workspaceRoot: string): Promise<GoTestRunResult> {
    const item = this.createRunItem(target);
    this.controller.items.add(item);

    const request = new vscode.TestRunRequest([item]);
    const run = this.controller.createTestRun(request, `Run ${target.label}`);
    const parser = new GoTestJsonStreamParser();
    const expectedTestName = buildGoTestJsonTestName(target);
    const outputByTestName = new Map<string, string[]>();
    let completed = false;

    const handleRecord = (record: GoTestJsonStreamRecord): void => {
      if (record.kind === 'raw') {
        appendRunOutput(run, `${record.line}\n`);
        return;
      }
      const didComplete = this.applyGoTestJsonEvent(run, item, record.event, expectedTestName, outputByTestName);
      completed ||= didComplete;
    };

    run.enqueued(item);
    run.started(item);
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

      if (!completed) {
        if (result.success) {
          run.passed(item);
        } else {
          run.failed(item, createFailureMessage(target, expectedTestName, outputByTestName, result.code));
        }
      }

      return result;
    } catch (error) {
      run.failed(item, new vscode.TestMessage(`Go Bench: ${error instanceof Error ? error.message : String(error)}`));
      throw error;
    } finally {
      run.end();
    }
  }

  /** 释放 CodeLens 运行结果 controller。 */
  public dispose(): void {
    this.controller.dispose();
  }

  private createRunItem(target: GoTestRunTarget): vscode.TestItem {
    const id = ['go-bench-codelens', target.file, target.testName, ...target.subtestPath].map(encodeURIComponent).join('/');
    this.controller.items.delete(id);
    return this.controller.createTestItem(id, target.label, vscode.Uri.file(target.file));
  }

  private applyGoTestJsonEvent(
    run: vscode.TestRun,
    item: vscode.TestItem,
    event: GoTestJsonEvent,
    expectedTestName: string,
    outputByTestName: Map<string, string[]>
  ): boolean {
    if (event.Action === 'output') {
      const output = event.Output ?? '';
      if (output.length > 0) {
        appendRunOutput(run, output, event.Test === expectedTestName ? item : undefined);
        this.output.append(output);
        if (event.Test) {
          const existing = outputByTestName.get(event.Test) ?? [];
          existing.push(output);
          outputByTestName.set(event.Test, existing);
        }
      }
      return false;
    }

    if (event.Test !== expectedTestName) {
      return false;
    }

    if (event.Action === 'pass') {
      run.passed(item, toDurationMs(event.Elapsed));
      return true;
    }

    if (event.Action === 'skip') {
      run.skipped(item);
      return true;
    }

    if (event.Action === 'fail') {
      run.failed(item, createFailureMessageFromOutput(expectedTestName, outputByTestName), toDurationMs(event.Elapsed));
      return true;
    }

    return false;
  }
}

function createFailureMessage(
  target: GoTestRunTarget,
  expectedTestName: string,
  outputByTestName: Map<string, string[]>,
  code: number | null
): vscode.TestMessage {
  const output = (outputByTestName.get(expectedTestName) ?? []).join('').trim();
  const message =
    output.length > 0 ? output : `go test failed for ${target.label} with exit code ${code ?? 'unknown'}.`;
  return new vscode.TestMessage(message);
}

function createFailureMessageFromOutput(
  expectedTestName: string,
  outputByTestName: Map<string, string[]>
): vscode.TestMessage {
  const output = (outputByTestName.get(expectedTestName) ?? []).join('').trim();
  return new vscode.TestMessage(output.length > 0 ? output : 'go test failed.');
}

function appendRunOutput(run: vscode.TestRun, output: string, item?: vscode.TestItem): void {
  run.appendOutput(output.replace(/\r?\n/g, '\r\n'), undefined, item);
}

function toDurationMs(elapsed: number | undefined): number | undefined {
  if (typeof elapsed !== 'number') {
    return undefined;
  }
  return Math.max(0, Math.round(elapsed * 1000));
}
