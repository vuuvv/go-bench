/**
 * Go main 函数 CodeLens provider。
 *
 * 该 provider 只处理普通可执行 Go 文件上的 `func main`，不参与 `_test.go` 的测试 CodeLens。
 * CodeLens 点击后复用 Run and Debug runnable 命令，保证编辑器入口和侧边栏入口行为一致。
 */

import { dirname, relative, sep } from 'node:path';
import * as vscode from 'vscode';
import { commands } from './constants';
import { resolveGoModuleInfo } from './goModule';
import { isGoTestFile, type SourceRange } from './parser';
import { createGoMainCodeLensTargets, type GoMainCodeLensTarget } from './mainCodeLensTargets';
import type { RunnableWorkspaceFolder } from './runnablesModel';

/** 为 Go `func main` 提供 Run Main / Debug Main CodeLens。 */
export class GoMainCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();

  /** VSCode 监听该事件后，会重新请求当前可见文档的 main CodeLens。 */
  public readonly onDidChangeCodeLenses: vscode.Event<void> = this.changeEmitter.event;

  /** 根据当前文档文本生成 main 函数运行和调试入口。 */
  public provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.CodeLens[] {
    void token;
    const file = document.uri.fsPath;
    if (isGoTestFile(file)) {
      return [];
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) {
      return [];
    }

    return createGoMainCodeLensTargets({
      file,
      source: document.getText(),
      workspaceFolder: toRunnableWorkspaceFolder(workspaceFolder),
      ...buildModuleLabelInput(file)
    }).map(target => new vscode.CodeLens(toVsCodeRange(target.range), toCommand(target)));
  }

  /** 文档变更时刷新 main CodeLens，保证用户刚写出 `func main` 后入口能出现。 */
  public refreshDocument(file: string): void {
    if (!file.endsWith('.go') || isGoTestFile(file)) {
      return;
    }
    this.changeEmitter.fire();
  }

  /** 配置变化或批量刷新时重新请求 CodeLens。 */
  public refreshAll(): void {
    this.changeEmitter.fire();
  }

  /** 释放事件 emitter。 */
  public dispose(): void {
    this.changeEmitter.dispose();
  }
}

function toCommand(target: GoMainCodeLensTarget): vscode.Command {
  return {
    title: target.title,
    command: target.kind === 'run' ? commands.runRunnable : commands.debugRunnable,
    arguments: [target.runnable]
  };
}

function buildModuleLabelInput(file: string): { moduleName?: string; packageImportPath?: string } {
  const moduleInfo = resolveGoModuleInfo(file);
  if (!moduleInfo) {
    return {};
  }

  const relativePackageDir = relative(moduleInfo.dir, dirname(file));
  return {
    moduleName: moduleInfo.name,
    packageImportPath: relativePackageDir === '' ? '' : relativePackageDir.split(sep).join('/')
  };
}

function toRunnableWorkspaceFolder(workspaceFolder: vscode.WorkspaceFolder): RunnableWorkspaceFolder {
  return {
    name: workspaceFolder.name,
    path: workspaceFolder.uri.fsPath
  };
}

function toVsCodeRange(range: SourceRange): vscode.Range {
  return new vscode.Range(
    new vscode.Position(range.start.line, range.start.character),
    new vscode.Position(range.end.line, range.end.character)
  );
}
