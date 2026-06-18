/**
 * Go Plus VSCode 扩展入口。
 *
 * 入口负责把可独立测试的模块接入 VSCode 生命周期：注册命令、创建 output channel、挂载 Go 测试
 * 文件 CodeLens provider，并把用户点击的运行目标交给 runner。具体识别和命令构造留在独立模块，
 * 让 Extension Host 入口保持薄而稳定。
 */

import { dirname } from 'node:path';
import * as vscode from 'vscode';
import { commands, outputChannelName } from './constants';
import { GoTestCodeLensProvider } from './codelens';
import { runGoTestTarget, type GoTestRunTarget } from './runner';

/**
 * 激活扩展并注册当前阶段的基础能力。
 *
 * VSCode 会在 `package.json` 中声明的 Go 语言、Go 测试文件或 no-op 命令触发时调用该函数。
 * output channel 放入 `context.subscriptions`，确保 Extension Host 关闭或重载时能释放资源。
 */
export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel(outputChannelName);
  context.subscriptions.push(outputChannel);

  outputChannel.appendLine('Go Plus activated.');

  const noopCommand = vscode.commands.registerCommand(commands.noop, () => {
    outputChannel.appendLine('Go Plus no-op command executed.');
    void vscode.window.showInformationMessage('Go Plus is active.');
  });

  const runTestCommand = vscode.commands.registerCommand(commands.runTest, async (target: GoTestRunTarget) => {
    outputChannel.show(true);

    try {
      const normalizedTarget = normalizeRunTarget(target);
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(normalizedTarget.file));
      if (!workspaceFolder) {
        void vscode.window.showErrorMessage('Go Plus: cannot determine workspace folder for this Go test file.');
        return;
      }

      const result = await runGoTestTarget(normalizedTarget, {
        workspaceRoot: workspaceFolder.uri.fsPath,
        output: outputChannel
      });

      if (!result.success) {
        void vscode.window.showErrorMessage(`Go Plus: go test failed with exit code ${result.code ?? 'unknown'}.`);
      }
    } catch (error) {
      outputChannel.appendLine(`Go Plus run failed: ${String(error)}`);
      void vscode.window.showErrorMessage(`Go Plus: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  const codeLensProvider = vscode.languages.registerCodeLensProvider(
    { language: 'go', scheme: 'file', pattern: '**/*_test.go' },
    new GoTestCodeLensProvider({ output: outputChannel })
  );

  context.subscriptions.push(noopCommand, runTestCommand, codeLensProvider);
}

/**
 * 当前阶段无需显式清理状态。
 *
 * output channel 和命令注册都由 `context.subscriptions` 托管；保留该函数是为了让后续异步 watcher、
 * debounce timer 或 child process 管理有一个明确的关闭扩展点。
 */
export function deactivate(): void {
  // 由 VSCode 订阅生命周期统一释放资源。
}

function normalizeRunTarget(target: GoTestRunTarget): GoTestRunTarget {
  return {
    ...target,
    packageDir: target.packageDir ?? dirname(target.file),
    subtestPath: Array.isArray(target.subtestPath) ? target.subtestPath : []
  };
}
