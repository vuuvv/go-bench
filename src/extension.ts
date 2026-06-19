/**
 * Go Bench VSCode 扩展入口。
 *
 * 入口负责把可独立测试的模块接入 VSCode 生命周期：注册命令、创建 output channel、挂载 Go 测试
 * 文件 CodeLens provider，并把用户点击的运行目标交给 runner。具体识别和命令构造留在独立模块，
 * 让 Extension Host 入口保持薄而稳定。
 */

import { dirname } from 'node:path';
import * as vscode from 'vscode';
import {
  commands,
  configurationKeys,
  contextKeys,
  outputChannelName,
  standardGoTestExplorerConfigurationKey
} from './constants';
import { GoTestCodeLensProvider } from './codelens';
import { buildGoTestDebugConfiguration, type GoTestDebugConfiguration } from './debugger';
import { isGoTestFile } from './parser';
import type { GoTestRunTarget } from './runner';
import { registerGoBenchSidebar } from './sidebar';
import { GoBenchTestingApiPrototypeManager } from './testing';
import { GoBenchCodeLensTestResults } from './testResults';
import { normalizeTableTestConfig, shouldShowGoBenchTestExplorer } from './tableTestConfig';

/**
 * 激活扩展并注册当前阶段的基础能力。
 *
 * VSCode 会在 `package.json` 中声明的 Go 语言、Go 测试文件或 no-op 命令触发时调用该函数。
 * output channel 放入 `context.subscriptions`，确保 Extension Host 关闭或重载时能释放资源。
 */
export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel(outputChannelName);
  context.subscriptions.push(outputChannel);

  outputChannel.appendLine('Go Bench activated.');

  const codeLensTestResults = new GoBenchCodeLensTestResults({ output: outputChannel });

  const noopCommand = vscode.commands.registerCommand(commands.noop, () => {
    outputChannel.appendLine('Go Bench no-op command executed.');
    void vscode.window.showInformationMessage('Go Bench is active.');
  });

  const runTestCommand = vscode.commands.registerCommand(commands.runTest, async (target: unknown) => {
    try {
      const normalizedTarget = normalizeRunTarget(target);
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(normalizedTarget.file));
      if (!workspaceFolder) {
        void vscode.window.showErrorMessage('Go Bench: cannot determine workspace folder for this Go test file.');
        return;
      }

      const result = await codeLensTestResults.runTarget(normalizedTarget, workspaceFolder.uri.fsPath);

      if (!result.success) {
        void vscode.window.showErrorMessage(`Go Bench: go test failed with exit code ${result.code ?? 'unknown'}.`);
      }
    } catch (error) {
      outputChannel.appendLine(`Go Bench run failed: ${String(error)}`);
      void vscode.window.showErrorMessage(`Go Bench: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  const debugTestCommand = vscode.commands.registerCommand(commands.debugTest, async (target: unknown) => {
    try {
      const normalizedTarget = normalizeRunTarget(target);
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(normalizedTarget.file));
      if (!workspaceFolder) {
        void vscode.window.showErrorMessage('Go Bench: cannot determine workspace folder for this Go test file.');
        return;
      }

      const configuration = buildGoTestDebugConfiguration(normalizedTarget);
      outputChannel.appendLine('');
      outputChannel.appendLine(`Debugging ${normalizedTarget.label}`);
      outputChannel.appendLine(`Go Bench debug configuration: ${JSON.stringify(configuration)}`);

      const started = await startDebuggingAndVerify(workspaceFolder, configuration, normalizedTarget.label);
      if (!started) {
        void vscode.window.showErrorMessage('Go Bench: failed to start Go test debugging.');
      }
    } catch (error) {
      outputChannel.appendLine(`Go Bench debug failed: ${String(error)}`);
      void vscode.window.showErrorMessage(`Go Bench: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  const goTestCodeLensProvider = new GoTestCodeLensProvider({ output: outputChannel });
  const testingApiPrototype = new GoBenchTestingApiPrototypeManager({ output: outputChannel });
  void applyTestExplorerTreeVisibility(testingApiPrototype, outputChannel);

  const refreshTestTreeCommand = vscode.commands.registerCommand(commands.refreshTestTree, async () => {
    outputChannel.show(true);
    if (!readTestingApiEnabledFromWorkspace()) {
      void vscode.window.showInformationMessage(
        'Go Bench: enable goBench.tableTests.testingApi.enabled before refreshing the Test Explorer tree.'
      );
      return;
    }

    const shouldShowGoBenchTree = await applyTestExplorerTreeVisibility(testingApiPrototype, outputChannel);
    if (!shouldShowGoBenchTree) {
      void vscode.window.showInformationMessage(
        'Go Bench: switch Test Explorer tree mode to goBench before refreshing the Go Bench tree.'
      );
      return;
    }

    const refreshed = await testingApiPrototype.refreshWorkspace();
    void vscode.window.showInformationMessage(`Go Bench: refreshed Test Explorer tree from ${refreshed} Go test file(s).`);
  });

  const refreshCurrentFileTestTreeCommand = vscode.commands.registerCommand(
    commands.refreshCurrentFileTestTree,
    async (fileArg: unknown) => {
      outputChannel.show(true);
      if (!readTestingApiEnabledFromWorkspace()) {
        void vscode.window.showInformationMessage(
          'Go Bench: enable goBench.tableTests.testingApi.enabled before refreshing the current file in Test Explorer.'
        );
        return;
      }

      const file = normalizeRefreshFileArgument(fileArg);
      if (!file || !isGoTestFile(file)) {
        void vscode.window.showErrorMessage('Go Bench: open a Go _test.go file before refreshing the current test tree.');
        return;
      }

      const shouldShowGoBenchTree = await applyTestExplorerTreeVisibility(testingApiPrototype, outputChannel);
      if (!shouldShowGoBenchTree) {
        void vscode.window.showInformationMessage(
          'Go Bench: switch Test Explorer tree mode to goBench before refreshing the Go Bench tree.'
        );
        return;
      }

      const refreshed = await testingApiPrototype.refreshFile(file);
      if (!refreshed) {
        void vscode.window.showErrorMessage('Go Bench: current file is not a Go test file.');
        return;
      }
      void vscode.window.showInformationMessage('Go Bench: refreshed current file in Test Explorer.');
    }
  );

  const toggleTestTreeMode = async (): Promise<void> => {
    const currentMode = readTestingApiTreeModeFromWorkspace();
    const nextMode = currentMode === 'goBench' ? 'standardGo' : 'goBench';
    await vscode.workspace.getConfiguration().update(configurationKeys.testingApiTreeMode, nextMode, vscode.ConfigurationTarget.Workspace);
    outputChannel.appendLine(`Go Bench Testing API tree mode: ${nextMode}.`);

    const shouldShowGoBenchTree = await applyTestExplorerTreeVisibility(testingApiPrototype, outputChannel);
    if (shouldShowGoBenchTree) {
      const refreshed = await testingApiPrototype.refreshWorkspace();
      void vscode.window.showInformationMessage(
        `Go Bench: switched Test Explorer to ${formatTestingApiTreeMode(nextMode)}, hid the standard Go tree, and refreshed ${refreshed} Go test file(s).`
      );
      return;
    }

    const message =
      nextMode === 'standardGo'
        ? 'Go Bench: switched Test Explorer to the standard Go tree and hid the Go Bench tree.'
        : `Go Bench: switched Test Explorer to ${formatTestingApiTreeMode(nextMode)}. Enable goBench.tableTests.testingApi.enabled to show it.`;
    void vscode.window.showInformationMessage(message);
  };

  const toggleTestTreeModeCommand = vscode.commands.registerCommand(commands.toggleTestTreeMode, toggleTestTreeMode);
  const toggleTestTreeModeFromGoBenchCommand = vscode.commands.registerCommand(
    commands.toggleTestTreeModeFromGoBench,
    toggleTestTreeMode
  );
  const toggleTestTreeModeFromStandardGoCommand = vscode.commands.registerCommand(
    commands.toggleTestTreeModeFromStandardGo,
    toggleTestTreeMode
  );
  const sidebarRegistration = registerGoBenchSidebar({
    output: outputChannel,
    refreshTests: async () => {
      await vscode.commands.executeCommand(commands.refreshTestTree);
    }
  });

  const codeLensRegistration = vscode.languages.registerCodeLensProvider(
    { language: 'go', scheme: 'file', pattern: '**/*_test.go' },
    goTestCodeLensProvider
  );

  const documentChangeSubscription = vscode.workspace.onDidChangeTextDocument(event => {
    goTestCodeLensProvider.refreshDocument(event.document.uri.fsPath);
    testingApiPrototype.refreshDocument(event.document);
  });
  const documentSaveSubscription = vscode.workspace.onDidSaveTextDocument(document => {
    goTestCodeLensProvider.refreshDocument(document.uri.fsPath);
    testingApiPrototype.refreshDocument(document);
  });
  const configurationSubscription = vscode.workspace.onDidChangeConfiguration(event => {
    if (Object.values(configurationKeys).some(key => event.affectsConfiguration(key))) {
      goTestCodeLensProvider.refreshAll();
      void applyTestExplorerTreeVisibility(testingApiPrototype, outputChannel);
      for (const document of vscode.workspace.textDocuments) {
        testingApiPrototype.refreshDocument(document);
      }
    }
  });

  context.subscriptions.push(
    noopCommand,
    runTestCommand,
    debugTestCommand,
    codeLensTestResults,
    refreshTestTreeCommand,
    refreshCurrentFileTestTreeCommand,
    toggleTestTreeModeCommand,
    toggleTestTreeModeFromGoBenchCommand,
    toggleTestTreeModeFromStandardGoCommand,
    sidebarRegistration,
    goTestCodeLensProvider,
    testingApiPrototype,
    codeLensRegistration,
    documentChangeSubscription,
    documentSaveSubscription,
    configurationSubscription
  );
}

function normalizeRefreshFileArgument(fileArg: unknown): string | undefined {
  if (typeof fileArg === 'string' && fileArg !== '') {
    return fileArg;
  }
  return vscode.window.activeTextEditor?.document.uri.fsPath;
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

/** 从 VSCode 配置读取实验 Testing API 开关。 */
function readTestingApiEnabledFromWorkspace(): boolean {
  const configuration = vscode.workspace.getConfiguration();
  return normalizeTableTestConfig({
    testingApiEnabled: configuration.get(configurationKeys.testingApiEnabled)
  }).testingApiEnabled;
}

/** 当前配置是否应该显示 Go Bench 自己的 Test Explorer 树。 */
function shouldShowGoBenchTestExplorerFromWorkspace(): boolean {
  const configuration = vscode.workspace.getConfiguration();
  const config = normalizeTableTestConfig({
    enabled: configuration.get(configurationKeys.enabled),
    testingApiEnabled: configuration.get(configurationKeys.testingApiEnabled),
    testingApiTreeMode: configuration.get(configurationKeys.testingApiTreeMode)
  });
  return shouldShowGoBenchTestExplorer(config);
}

/** 从 VSCode 配置读取 Testing API 树模式。 */
function readTestingApiTreeModeFromWorkspace(): 'goBench' | 'standardGo' {
  const configuration = vscode.workspace.getConfiguration();
  return normalizeTableTestConfig({
    testingApiTreeMode: configuration.get(configurationKeys.testingApiTreeMode)
  }).testingApiTreeMode;
}

function formatTestingApiTreeMode(mode: 'goBench' | 'standardGo'): string {
  return mode === 'goBench' ? 'Go Bench tree' : 'standard Go tree';
}

async function applyTestExplorerTreeVisibility(
  testingApiPrototype: GoBenchTestingApiPrototypeManager,
  outputChannel: vscode.OutputChannel
): Promise<boolean> {
  await updateTestExplorerTreeModeContext(readTestingApiTreeModeFromWorkspace());
  const shouldShowGoBenchTree = shouldShowGoBenchTestExplorerFromWorkspace();
  testingApiPrototype.setEnabled(shouldShowGoBenchTree);
  await setStandardGoTestExplorerEnabled(!shouldShowGoBenchTree, outputChannel);
  return shouldShowGoBenchTree;
}

async function updateTestExplorerTreeModeContext(mode: 'goBench' | 'standardGo'): Promise<void> {
  await vscode.commands.executeCommand('setContext', contextKeys.testTreeModeGoBench, mode === 'goBench');
  await vscode.commands.executeCommand('setContext', contextKeys.testTreeModeStandardGo, mode === 'standardGo');
}

async function setStandardGoTestExplorerEnabled(
  enabled: boolean,
  outputChannel: vscode.OutputChannel
): Promise<void> {
  const configuration = vscode.workspace.getConfiguration();
  if (configuration.get(standardGoTestExplorerConfigurationKey) !== enabled) {
    await configuration.update(
      standardGoTestExplorerConfigurationKey,
      enabled,
      vscode.ConfigurationTarget.Workspace
    );
  }

  if (enabled) {
    const goExtension = vscode.extensions.getExtension('golang.go');
    if (goExtension && !goExtension.isActive) {
      try {
        await goExtension.activate();
      } catch (error) {
        outputChannel.appendLine(`Go Bench: failed to activate the official Go extension test explorer: ${String(error)}`);
      }
    }
  }
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

function normalizeRunTarget(target: unknown): GoTestRunTarget {
  if (!target || typeof target !== 'object') {
    throw new Error('Run target is missing. Trigger this command from a Go Bench CodeLens entry.');
  }

  const candidate = target as Partial<GoTestRunTarget>;
  if (typeof candidate.file !== 'string' || candidate.file === '') {
    throw new Error('Run target does not include a Go test file path.');
  }
  if (typeof candidate.testName !== 'string' || candidate.testName === '') {
    throw new Error('Run target does not include a Go test function name.');
  }
  if (typeof candidate.label !== 'string' || candidate.label === '') {
    throw new Error('Run target does not include a display label.');
  }

  return {
    file: candidate.file,
    packageDir: typeof candidate.packageDir === 'string' ? candidate.packageDir : dirname(candidate.file),
    testName: candidate.testName,
    subtestPath: Array.isArray(candidate.subtestPath)
      ? candidate.subtestPath.filter((segment): segment is string => typeof segment === 'string')
      : [],
    label: candidate.label
  };
}
