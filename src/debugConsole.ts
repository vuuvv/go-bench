import * as vscode from 'vscode';
import {
  formatDebugConsoleOutput,
  formatDebugConsoleOutputChannelName,
  isDapOutputEventMessage,
  normalizeOutputViewNewlines
} from './debugConsoleModel';

type DapEvaluateResponse = {
  result?: string;
  type?: string;
  variablesReference?: number;
};

export class GoBenchDebugConsole implements vscode.Disposable {
  private readonly output: vscode.OutputChannel;
  private session: vscode.DebugSession | undefined;
  private lastExpression = '';

  public constructor(private readonly label: string) {
    this.output = vscode.window.createOutputChannel(formatDebugConsoleOutputChannelName(label));
  }

  public attachSession(session: vscode.DebugSession): void {
    this.session = session;
    this.writeStatus(`Debug session started: ${session.name}`);
  }

  public detachSession(message: string): void {
    if (!this.session) {
      return;
    }
    this.writeStatus(message);
    this.session = undefined;
  }

  public appendDebugAdapterMessage(message: unknown): void {
    if (!isDapOutputEventMessage(message)) {
      return;
    }
    const output = formatDebugConsoleOutput(message);
    if (output) {
      this.output.append(output);
    }
  }

  public show(preserveFocus = false): void {
    this.output.show(preserveFocus);
  }

  public clear(): void {
    this.output.clear();
  }

  public matchesSession(session: vscode.DebugSession): boolean {
    return this.session === session;
  }

  public async evaluateFromInputBox(): Promise<void> {
    const expression = await vscode.window.showInputBox({
      title: `Evaluate in ${formatDebugConsoleOutputChannelName(this.label)}`,
      prompt: 'Expression',
      value: this.lastExpression
    });
    if (expression === undefined) {
      return;
    }
    await this.evaluateExpression(expression);
  }

  public async evaluateExpression(expression: string): Promise<void> {
    this.lastExpression = expression;
    this.output.appendLine(`> ${expression}`);
    if (expression.trim() === '') {
      return;
    }

    const session = this.session;
    if (!session) {
      this.writeError('No active debug session.');
      return;
    }

    try {
      const response = await session.customRequest('evaluate', {
        expression,
        context: 'repl',
        frameId: resolveActiveDebugFrameId(session)
      }) as DapEvaluateResponse;
      this.writeEvaluationResponse(response);
    } catch (error) {
      this.writeError(error instanceof Error ? error.message : String(error));
    }
  }

  public dispose(): void {
    this.session = undefined;
    this.output.dispose();
  }

  private writeEvaluationResponse(response: DapEvaluateResponse): void {
    if (response.result) {
      this.output.appendLine(normalizeOutputViewNewlines(response.result));
    }
    if (response.type && response.result && !response.result.includes(response.type)) {
      this.output.appendLine(response.type);
    }
    if (response.variablesReference && response.variablesReference > 0) {
      this.output.appendLine(`variablesReference: ${response.variablesReference}`);
    }
  }

  private writeStatus(message: string): void {
    this.output.appendLine(message);
  }

  private writeError(message: string): void {
    this.output.appendLine(`Error: ${message}`);
  }
}

export function resolveActiveDebugFrameId(session: vscode.DebugSession): number | undefined {
  const activeStackItem = vscode.debug.activeStackItem;
  if (!activeStackItem || activeStackItem.session !== session || !('frameId' in activeStackItem)) {
    return undefined;
  }
  return activeStackItem.frameId;
}
