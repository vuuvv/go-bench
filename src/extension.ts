/**
 * Go Plus VSCode 扩展入口。
 *
 * 里程碑 0 只负责完成可启动骨架：注册命令、创建 output channel，并在 Go 文件或工作区存在
 * `_test.go` 文件时激活。后续里程碑会在这个入口继续挂载 parser、CodeLens provider 和 runner。
 */

import * as vscode from 'vscode';
import { commands, outputChannelName } from './constants';

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

  context.subscriptions.push(noopCommand);
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
