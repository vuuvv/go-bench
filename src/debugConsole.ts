import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import * as vscode from 'vscode';
import { commands, configurationKeys, debugPanelViewIds } from './constants';
import { formatDebugConsoleOutput, formatDebugConsoleSessionTitle, isDapOutputEventMessage } from './debugConsoleModel';
import type { GoBenchRunnableItem, GoBenchRunnableKind } from './runnablesModel';

type DapEvaluateResponse = {
  result?: string;
  type?: string;
  variablesReference?: number;
};

type DebugConsoleMessage = {
  kind: 'output' | 'input' | 'result' | 'error' | 'status';
  text: string;
};

type WebviewMessage =
  | { command: 'ready' }
  | { command: 'select'; itemId?: string }
  | { command: 'clear'; itemId?: string }
  | { command: 'deleteEnded'; itemId?: string }
  | { command: 'setSearchQuery'; value?: string }
  | { command: 'setFilterQuery'; value?: string }
  | { command: 'runnableAction'; itemId?: string; action?: DebugConsoleRunnableAction }
  | { command: 'evaluate'; itemId?: string; expression?: string };

const maxEndedDebugConsoles = 100;
const persistedSessionsKey = 'goBench.debugConsole.sessions';

type DebugConsoleRunnableAction = 'run' | 'debug' | 'stop' | 'restart' | 'pause' | 'reveal';

type PersistedDebugConsoleSession = {
  itemId: string;
  runnableId: string;
  label: string;
  startedAt: number;
  endedAt?: number;
  logFile: string;
};

export class GoBenchDebugConsolePanel implements vscode.WebviewViewProvider, vscode.Disposable {
  private readonly consoles = new Map<string, GoBenchDebugConsole>();
  private readonly activeConsoleIdsByRunnable = new Map<string, string>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly logsDirectory: vscode.Uri | undefined;
  private view: vscode.WebviewView | undefined;
  private activeItemId: string | undefined;
  private searchQuery = '';
  private filterQuery = '';

  public constructor(private readonly context: vscode.ExtensionContext) {
    this.logsDirectory = context.storageUri ? vscode.Uri.joinPath(context.storageUri, 'go-bench-debug-sessions') : undefined;
    this.disposables.push(vscode.window.registerWebviewViewProvider(debugPanelViewIds.debugConsole, this, {
      webviewOptions: {
        retainContextWhenHidden: true
      }
    }));
    this.disposables.push(
      vscode.commands.registerCommand(commands.clearPanelDebugConsole, () => {
        this.clearActiveConsole();
      }),
      vscode.commands.registerCommand(commands.clearEndedPanelDebugConsole, () => {
        this.deleteAllEndedConsoles();
      }),
      vscode.commands.registerCommand(commands.searchPanelDebugConsole, async () => {
        this.focusSearchQuery();
      }),
      vscode.commands.registerCommand(commands.filterPanelDebugConsole, async () => {
        this.focusFilterQuery();
      })
    );
    void this.restorePersistedSessions();
  }

  public getOrCreateConsole(runnableId: string, label: string): GoBenchDebugConsole {
    const activeConsoleId = this.activeConsoleIdsByRunnable.get(runnableId);
    let debugConsole = activeConsoleId ? this.consoles.get(activeConsoleId) : undefined;
    if (debugConsole?.ended) {
      debugConsole = undefined;
      this.activeConsoleIdsByRunnable.delete(runnableId);
    }
    if (!debugConsole) {
      const consoleId = `${runnableId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
      debugConsole = new GoBenchDebugConsole({
        itemId: consoleId,
        runnableId,
        label,
        panel: this
      });
      this.consoles.set(consoleId, debugConsole);
      this.activeConsoleIdsByRunnable.set(runnableId, consoleId);
      this.activeItemId = consoleId;
      this.postState();
      void this.persistSessions();
    }
    return debugConsole;
  }

  public getConsole(runnableId: string): GoBenchDebugConsole | undefined {
    const activeConsoleId = this.activeConsoleIdsByRunnable.get(runnableId);
    return activeConsoleId ? this.consoles.get(activeConsoleId) : this.consoles.get(runnableId);
  }

  public findConsoleBySession(session: vscode.DebugSession): GoBenchDebugConsole | undefined {
    for (const debugConsole of this.consoles.values()) {
      if (debugConsole.matchesSession(session)) {
        return debugConsole;
      }
    }
    return undefined;
  }

  public disposeConsole(runnableId: string): void {
    const activeConsoleId = this.activeConsoleIdsByRunnable.get(runnableId);
    for (const [consoleId, debugConsole] of this.consoles) {
      if (debugConsole.runnableId === runnableId || consoleId === activeConsoleId) {
        this.consoles.delete(consoleId);
        void this.deleteLogFile(debugConsole);
      }
    }
    this.activeConsoleIdsByRunnable.delete(runnableId);
    if (this.activeItemId && !this.consoles.has(this.activeItemId)) {
      this.activeItemId = this.selectDefaultActiveItemId();
    }
    this.postState();
    void this.persistSessions();
  }

  public deleteEndedConsole(itemId: string): void {
    const debugConsole = this.consoles.get(itemId);
    if (!debugConsole?.ended) {
      return;
    }
    this.consoles.delete(itemId);
    void this.deleteLogFile(debugConsole);
    if (this.activeItemId === itemId) {
      this.activeItemId = this.selectDefaultActiveItemId();
    }
    this.postState();
    void this.persistSessions();
  }

  public deleteAllEndedConsoles(): void {
    for (const [itemId, debugConsole] of this.consoles) {
      if (debugConsole.ended) {
        this.consoles.delete(itemId);
        void this.deleteLogFile(debugConsole);
      }
    }
    if (this.activeItemId && !this.consoles.has(this.activeItemId)) {
      this.activeItemId = this.selectDefaultActiveItemId();
    }
    this.postState();
    void this.persistSessions();
  }

  public showConsole(itemId: string, options: { focusInput?: boolean } = {}): void {
    if (this.consoles.has(itemId)) {
      this.activeItemId = itemId;
    }
    this.reveal();
    this.postState(options);
  }

  public notifyChanged(itemId: string): void {
    const debugConsole = this.consoles.get(itemId);
    if (debugConsole?.ended && this.activeConsoleIdsByRunnable.get(debugConsole.runnableId) === itemId) {
      this.activeConsoleIdsByRunnable.delete(debugConsole.runnableId);
    }
    if (!this.activeItemId || this.consoles.size === 1) {
      this.activeItemId = itemId;
    }
    this.pruneEndedConsoles();
    this.postState();
    void this.persistSessions();
  }

  public recordMessage(debugConsole: GoBenchDebugConsole, message: DebugConsoleMessage): void {
    this.notifyChanged(debugConsole.itemId);
    void this.appendLogMessage(debugConsole, message);
  }

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')]
    };
    webviewView.webview.html = buildDebugConsoleHtml(webviewView.webview, this.context.extensionUri);
    this.disposables.push(webviewView.webview.onDidReceiveMessage(message => {
      void this.handleWebviewMessage(message as WebviewMessage);
    }));
    this.postState();
  }

  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.consoles.clear();
    this.activeConsoleIdsByRunnable.clear();
    this.view = undefined;
  }

  private reveal(): void {
    if (this.view) {
      this.view.show(false);
      return;
    }
    void vscode.commands.executeCommand(`${debugPanelViewIds.debugConsole}.focus`);
  }

  private async handleWebviewMessage(message: WebviewMessage): Promise<void> {
    if (message.command === 'ready') {
      this.postState();
      return;
    }

    if (message.command === 'setSearchQuery') {
      this.searchQuery = message.value ?? '';
      this.postState();
      return;
    }

    if (message.command === 'setFilterQuery') {
      this.filterQuery = message.value ?? '';
      this.postState();
      return;
    }

    const itemId = message.itemId ?? this.activeItemId;
    if (!itemId) {
      return;
    }

    if (message.command === 'deleteEnded') {
      this.deleteEndedConsole(itemId);
      return;
    }

    if (message.command === 'runnableAction') {
      await this.runRunnableAction(itemId, message.action);
      return;
    }

    if (message.command === 'select') {
      this.activeItemId = itemId;
      this.postState({ focusInput: true });
      return;
    }

    const debugConsole = this.consoles.get(itemId);
    if (!debugConsole) {
      return;
    }

    if (message.command === 'clear') {
      debugConsole.clear();
      return;
    }

    if (message.command === 'evaluate' && typeof message.expression === 'string') {
      await debugConsole.evaluateExpression(message.expression);
    }
  }

  private postState(options: { focusInput?: boolean; focusSearch?: boolean; focusFilter?: boolean } = {}): void {
    const view = this.view;
    if (!view) {
      return;
    }

    const runnableItems = this.readRunnableItems();
    const sessions = this.sortConsolesForView().map(debugConsole => debugConsole.toSnapshot(
      runnableItems.find(item => item.id === debugConsole.runnableId)
    ));
    const activeItemId = this.activeItemId ?? sessions[0]?.itemId;
    void view.webview.postMessage({
      command: 'state',
      activeItemId,
      focusInput: options.focusInput === true,
      focusSearch: options.focusSearch === true,
      focusFilter: options.focusFilter === true,
      searchQuery: this.searchQuery,
      filterQuery: this.filterQuery,
      sessions
    });
  }

  private clearActiveConsole(): void {
    const itemId = this.activeItemId;
    const debugConsole = itemId ? this.consoles.get(itemId) : undefined;
    debugConsole?.clear();
  }

  private focusSearchQuery(): void {
    this.reveal();
    this.postState({ focusSearch: true });
  }

  private focusFilterQuery(): void {
    this.reveal();
    this.postState({ focusFilter: true });
  }

  private async runRunnableAction(itemId: string, action: DebugConsoleRunnableAction | undefined): Promise<void> {
    const debugConsole = this.consoles.get(itemId);
    const runnableItem = debugConsole ? this.readRunnableItems().find(item => item.id === debugConsole.runnableId) : undefined;
    if (!runnableItem || !action) {
      return;
    }

    const command = this.resolveRunnableActionCommand(action);
    if (!command) {
      return;
    }
    await vscode.commands.executeCommand(command, runnableItem);
  }

  private resolveRunnableActionCommand(action: DebugConsoleRunnableAction): string | undefined {
    switch (action) {
      case 'run':
        return commands.runRunnable;
      case 'debug':
        return commands.debugRunnable;
      case 'stop':
        return commands.stopRunnable;
      case 'restart':
        return commands.restartRunnable;
      case 'pause':
        return commands.pauseRunnableDebug;
      case 'reveal':
        return commands.revealRunnable;
      default:
        return undefined;
    }
  }

  private readRunnableItems(): GoBenchRunnableItem[] {
    return vscode.workspace.getConfiguration().get<GoBenchRunnableItem[]>(configurationKeys.runnableItems, []);
  }

  private sortConsolesForView(): GoBenchDebugConsole[] {
    return [...this.consoles.values()].sort((left, right) => {
      if (left.connected !== right.connected) {
        return left.connected ? -1 : 1;
      }
      if (!left.connected && !right.connected) {
        return (right.endedAt ?? 0) - (left.endedAt ?? 0);
      }
      return left.startedAt - right.startedAt;
    });
  }

  private pruneEndedConsoles(): void {
    const ended = [...this.consoles.values()]
      .filter(debugConsole => debugConsole.ended)
      .sort((left, right) => (right.endedAt ?? 0) - (left.endedAt ?? 0));
    const expired = ended.slice(maxEndedDebugConsoles);
    for (const debugConsole of expired) {
      this.consoles.delete(debugConsole.itemId);
      void this.deleteLogFile(debugConsole);
    }
    if (this.activeItemId && !this.consoles.has(this.activeItemId)) {
      this.activeItemId = this.selectDefaultActiveItemId();
    }
  }

  private selectDefaultActiveItemId(): string | undefined {
    return this.sortConsolesForView()[0]?.itemId;
  }

  private async restorePersistedSessions(): Promise<void> {
    const persisted = this.context.workspaceState.get<PersistedDebugConsoleSession[]>(persistedSessionsKey, []);
    for (const session of persisted.slice(0, maxEndedDebugConsoles)) {
      const messages = await this.readLogMessages(session.logFile);
      const debugConsole = new GoBenchDebugConsole({
        itemId: session.itemId,
        runnableId: session.runnableId,
        label: session.label,
        panel: this,
        startedAt: session.startedAt,
        endedAt: session.endedAt ?? Date.now(),
        messages,
        logFile: session.logFile
      });
      this.consoles.set(session.itemId, debugConsole);
    }
    this.activeItemId = this.selectDefaultActiveItemId();
    this.postState();
  }

  private async persistSessions(): Promise<void> {
    const ended = this.sortConsolesForView()
      .filter(debugConsole => debugConsole.ended)
      .slice(0, maxEndedDebugConsoles)
      .map(debugConsole => debugConsole.toPersistedSession());
    await this.context.workspaceState.update(persistedSessionsKey, ended);
  }

  private async appendLogMessage(debugConsole: GoBenchDebugConsole, message: DebugConsoleMessage): Promise<void> {
    if (!this.logsDirectory) {
      return;
    }
    await mkdir(this.logsDirectory.fsPath, { recursive: true });
    await appendFile(this.resolveLogFile(debugConsole.logFile).fsPath, `${JSON.stringify(message)}\n`, 'utf8');
  }

  private async readLogMessages(logFile: string): Promise<DebugConsoleMessage[]> {
    if (!this.logsDirectory) {
      return [];
    }
    try {
      const text = await readFile(this.resolveLogFile(logFile).fsPath, 'utf8');
      return text
        .split(/\r?\n/)
        .filter(line => line.trim() !== '')
        .map(line => JSON.parse(line) as DebugConsoleMessage)
        .filter(isDebugConsoleMessage);
    } catch {
      return [];
    }
  }

  public async rewriteLogFile(debugConsole: GoBenchDebugConsole): Promise<void> {
    if (!this.logsDirectory) {
      return;
    }
    await mkdir(this.logsDirectory.fsPath, { recursive: true });
    await writeFile(
      this.resolveLogFile(debugConsole.logFile).fsPath,
      debugConsole.messages.map(message => JSON.stringify(message)).join('\n'),
      'utf8'
    );
  }

  private async deleteLogFile(debugConsole: GoBenchDebugConsole): Promise<void> {
    if (!this.logsDirectory) {
      return;
    }
    await rm(this.resolveLogFile(debugConsole.logFile).fsPath, { force: true });
  }

  private resolveLogFile(logFile: string): vscode.Uri {
    return this.logsDirectory ? vscode.Uri.joinPath(this.logsDirectory, logFile) : vscode.Uri.file(logFile);
  }
}

export class GoBenchDebugConsole {
  public readonly messages: DebugConsoleMessage[];
  private session: vscode.DebugSession | undefined;
  private endedAtValue: number | undefined;
  public readonly startedAt: number;
  public readonly itemId: string;
  public readonly runnableId: string;
  public readonly logFile: string;
  private readonly label: string;
  private readonly panel: GoBenchDebugConsolePanel;

  public constructor(options: {
    itemId: string;
    runnableId: string;
    label: string;
    panel: GoBenchDebugConsolePanel;
    startedAt?: number;
    endedAt?: number;
    messages?: DebugConsoleMessage[];
    logFile?: string;
  }) {
    this.itemId = options.itemId;
    this.runnableId = options.runnableId;
    this.label = options.label;
    this.panel = options.panel;
    this.startedAt = options.startedAt ?? Date.now();
    this.endedAtValue = options.endedAt;
    this.messages = options.messages ?? [];
    this.logFile = options.logFile ?? `${sanitizeLogFileName(options.itemId)}.jsonl`;
  }

  public attachSession(session: vscode.DebugSession): void {
    this.session = session;
    this.endedAtValue = undefined;
    this.writeStatus(`Debug session started: ${session.name}`);
  }

  public detachSession(message: string): void {
    if (!this.session) {
      return;
    }
    this.writeStatus(message);
    this.session = undefined;
    this.endedAtValue = Date.now();
    this.panel.notifyChanged(this.itemId);
  }

  public appendDebugAdapterMessage(message: unknown): void {
    if (!isDapOutputEventMessage(message)) {
      return;
    }
    const output = formatDebugConsoleOutput(message);
    if (output) {
      this.appendMessage('output', output);
    }
  }

  public show(options: { focusInput?: boolean } = {}): void {
    this.panel.showConsole(this.itemId, options);
  }

  public clear(): void {
    this.messages.length = 0;
    this.panel.notifyChanged(this.itemId);
    void this.panel.rewriteLogFile(this);
  }

  public matchesSession(session: vscode.DebugSession): boolean {
    return this.session === session;
  }

  public get connected(): boolean {
    return this.endedAtValue === undefined;
  }

  public get ended(): boolean {
    return this.endedAtValue !== undefined;
  }

  public get endedAt(): number | undefined {
    return this.endedAtValue;
  }

  public async evaluateExpression(expression: string): Promise<void> {
    this.appendMessage('input', `> ${expression}\n`);
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

  public focusInput(): void {
    this.show({ focusInput: true });
  }

  public toSnapshot(runnableItem?: GoBenchRunnableItem): {
    itemId: string;
    title: string;
    connected: boolean;
    startedAt: number;
    endedAt?: number;
    runnableExists: boolean;
    runnableKind?: GoBenchRunnableKind;
    messages: DebugConsoleMessage[];
  } {
    return {
      itemId: this.itemId,
      title: formatDebugConsoleSessionTitle(this.label),
      connected: this.connected,
      startedAt: this.startedAt,
      endedAt: this.endedAtValue,
      runnableExists: runnableItem !== undefined,
      runnableKind: runnableItem?.kind,
      messages: [...this.messages]
    };
  }

  public toPersistedSession(): PersistedDebugConsoleSession {
    return {
      itemId: this.itemId,
      runnableId: this.runnableId,
      label: this.label,
      startedAt: this.startedAt,
      endedAt: this.endedAtValue,
      logFile: this.logFile
    };
  }

  private writeEvaluationResponse(response: DapEvaluateResponse): void {
    if (response.result) {
      this.appendMessage('result', `${response.result}\n`);
    }
    if (response.type && response.result && !response.result.includes(response.type)) {
      this.appendMessage('status', `${response.type}\n`);
    }
    if (response.variablesReference && response.variablesReference > 0) {
      this.appendMessage('status', `variablesReference: ${response.variablesReference}\n`);
    }
  }

  private writeStatus(message: string): void {
    this.appendMessage('status', `${message}\n`);
  }

  private writeError(message: string): void {
    this.appendMessage('error', `${message}\n`);
  }

  private appendMessage(kind: DebugConsoleMessage['kind'], text: string): void {
    const message = { kind, text };
    this.messages.push(message);
    this.panel.recordMessage(this, message);
  }
}

function isDebugConsoleMessage(value: unknown): value is DebugConsoleMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as { kind?: unknown; text?: unknown };
  return (
    typeof candidate.text === 'string' &&
    (candidate.kind === 'output' ||
      candidate.kind === 'input' ||
      candidate.kind === 'result' ||
      candidate.kind === 'error' ||
      candidate.kind === 'status')
  );
}

function sanitizeLogFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_');
}

export function resolveActiveDebugFrameId(session: vscode.DebugSession): number | undefined {
  const activeStackItem = vscode.debug.activeStackItem;
  if (!activeStackItem || activeStackItem.session !== session || !('frameId' in activeStackItem)) {
    return undefined;
  }
  return activeStackItem.frameId;
}

function buildDebugConsoleHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = createNonce();
  const cspSource = webview.cspSource;
  const iconUris = createVscodeIconUris(webview, extensionUri);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource}; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      height: 100vh;
      padding: 0;
      margin: 0;
      color: var(--vscode-foreground);
      background: var(--vscode-panel-background, var(--vscode-editor-background));
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      overflow: hidden;
    }
    .layout {
      display: flex;
      height: 100vh;
      min-height: 0;
    }
    .main {
      display: flex;
      flex: 1;
      min-width: 0;
      min-height: 0;
      flex-direction: column;
    }
    .query-control {
      height: 24px;
      color: var(--vscode-input-foreground);
      background: transparent;
      border: 0;
      border-radius: 2px;
      padding: 2px 8px;
      font: inherit;
      box-sizing: border-box;
      outline: none;
    }
    .query-input-shell {
      display: flex;
      flex: 1 1 auto;
      min-width: 0;
      position: relative;
      align-items: center;
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 2px;
    }
    .query-input-shell:focus-within {
      border-color: var(--vscode-focusBorder);
    }
    .search-count {
      flex: 0 0 auto;
      min-width: 38px;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      text-align: center;
      white-space: nowrap;
    }
    .query-icon-button {
      display: flex;
      flex: 0 0 20px;
      width: 20px;
      height: 24px;
      border: 1px solid transparent;
      border-radius: 3px;
      color: var(--vscode-icon-foreground);
      background: transparent;
      cursor: pointer;
      padding: 2px;
      align-items: center;
      justify-content: center;
    }
    .query-icon-button:hover,
    .query-icon-button:focus,
    .query-icon-button.active {
      background: var(--vscode-toolbar-hoverBackground);
      border-color: var(--vscode-input-border, transparent);
    }
    .query-icon-button img {
      width: 14px;
      height: 14px;
      display: block;
    }
    .query-icon-button:disabled {
      opacity: 0.45;
      cursor: default;
    }
    .query-icon-button:disabled:hover {
      background: transparent;
      border-color: transparent;
    }
    .search-bar {
      display: flex;
      flex: 0 0 auto;
      min-width: 0;
      height: 34px;
      padding: 4px 8px;
      gap: 2px;
      border-bottom: 1px solid var(--vscode-panel-border);
      background: var(--vscode-panel-background, var(--vscode-editor-background));
      box-sizing: border-box;
      align-items: center;
    }
    .search-input {
      flex: 1 1 auto;
      min-width: 0;
      width: 100%;
    }
    .session-rail {
      display: flex;
      flex: 0 0 220px;
      min-width: 160px;
      max-width: 420px;
      flex-direction: column;
      gap: 0;
      padding: 4px 0 4px 6px;
      background: var(--vscode-sideBar-background);
      box-sizing: border-box;
    }
    .resize-handle {
      flex: 0 0 5px;
      width: 5px;
      cursor: col-resize;
      border-left: 1px solid var(--vscode-panel-border);
      background: var(--vscode-panel-background, var(--vscode-editor-background));
      box-sizing: border-box;
    }
    .resize-handle:hover,
    .resize-handle.dragging {
      background: var(--vscode-focusBorder);
    }
    body.resizing {
      cursor: col-resize;
      user-select: none;
    }
    .tree-root {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .tree-root-label {
      display: flex;
      width: 100%;
      height: 22px;
      border: 0;
      color: var(--vscode-foreground);
      background: transparent;
      padding: 0 6px 0 0;
      cursor: pointer;
      font: inherit;
      font-weight: 600;
      line-height: 22px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      text-align: left;
      align-items: center;
      gap: 5px;
    }
    .tree-root-label:hover {
      color: var(--vscode-foreground);
      background: var(--vscode-list-hoverBackground);
    }
    .tree-root-twistie {
      display: flex;
      flex: 0 0 22px;
      height: 22px;
      color: var(--vscode-icon-foreground);
      align-items: center;
      justify-content: center;
    }
    .tree-root-twistie::before {
      content: "";
      width: 6px;
      height: 6px;
      border-right: 1.5px solid currentColor;
      border-bottom: 1.5px solid currentColor;
      box-sizing: border-box;
    }
    .tree-root-twistie.expanded::before {
      transform: translateY(-1px) rotate(45deg);
    }
    .tree-root-twistie.collapsed::before {
      transform: translateX(-1px) rotate(-45deg);
    }
    .tree-root-text {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tree-children {
      display: flex;
      flex-direction: column;
      min-width: 0;
      margin-left: 10px;
      padding-left: 12px;
      position: relative;
    }
    .tree-children::before {
      content: "";
      position: absolute;
      top: 0;
      bottom: 0;
      left: 0;
      border-left: 1px solid var(--vscode-tree-indentGuidesStroke, var(--vscode-panel-border));
    }
    .tabs {
      display: flex;
      flex: 1;
      min-height: 0;
      flex-direction: column;
      overflow-y: auto;
    }
    .tab {
      display: flex;
      border: 0;
      color: var(--vscode-foreground);
      background: transparent;
      width: 100%;
      height: 22px;
      min-height: 22px;
      padding: 0 6px 0 0;
      border-radius: 0;
      cursor: pointer;
      font: inherit;
      line-height: 22px;
      align-items: center;
      gap: 6px;
      text-align: left;
      overflow: hidden;
    }
    .tab:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .tab.active {
      background: var(--vscode-list-activeSelectionBackground);
      color: var(--vscode-list-activeSelectionForeground);
    }
    .tab.disconnected {
      color: var(--vscode-descriptionForeground);
    }
    .session-icon {
      display: flex;
      flex: 0 0 18px;
      width: 18px;
      height: 18px;
      align-items: center;
      justify-content: center;
      color: var(--vscode-icon-foreground);
    }
    .session-icon.debugging {
      color: var(--vscode-debugIcon-continueForeground);
    }
    .session-icon.running {
      color: var(--vscode-debugIcon-startForeground);
    }
    .session-icon img {
      width: 16px;
      height: 16px;
      display: block;
    }
    .tab-title {
      display: block;
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tab-meta {
      display: block;
      flex: 0 0 auto;
      max-width: 104px;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tab:hover .tab-meta,
    .tab.active .tab-meta,
    .tab:focus-within .tab-meta {
      display: none;
    }
    .tab-actions {
      display: none;
      flex: 0 0 auto;
      align-items: center;
      gap: 1px;
      margin-left: 2px;
    }
    .tab:hover .tab-actions,
    .tab.active .tab-actions,
    .tab:focus-within .tab-actions {
      display: flex;
    }
    .inline-action {
      display: flex;
      flex: 0 0 18px;
      width: 18px;
      height: 18px;
      border: 0;
      border-radius: 3px;
      color: var(--vscode-icon-foreground);
      background: transparent;
      cursor: pointer;
      padding: 1px;
      align-items: center;
      justify-content: center;
    }
    .inline-action img {
      width: 14px;
      height: 14px;
      display: block;
    }
    .inline-action:hover,
    .inline-action:focus {
      background: var(--vscode-toolbar-hoverBackground);
    }
    .delete-session {
      flex: 0 0 18px;
      width: 18px;
      height: 18px;
      border: 0;
      border-radius: 3px;
      color: var(--vscode-icon-foreground);
      background: transparent;
      cursor: pointer;
      line-height: 18px;
      padding: 0;
      text-align: center;
      visibility: hidden;
    }
    .tab:hover .delete-session,
    .delete-session:focus {
      visibility: visible;
    }
    .delete-session:hover {
      background: var(--vscode-toolbar-hoverBackground);
    }
    .action {
      border: 1px solid var(--vscode-button-border, transparent);
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      border-radius: 3px;
      padding: 3px 9px;
      cursor: pointer;
      font: inherit;
    }
    .action:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .action.secondary {
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
    }
    .action.secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    .console-frame {
      flex: 1;
      min-height: 0;
      position: relative;
    }
    .console {
      height: 100%;
      min-height: 0;
      overflow: auto;
      padding: 8px 10px;
      box-sizing: border-box;
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
      white-space: pre-wrap;
      word-break: break-word;
    }
    .empty {
      color: var(--vscode-descriptionForeground);
      padding: 16px;
    }
    .message.input { color: var(--vscode-debugTokenExpression-name); }
    .message.error { color: var(--vscode-errorForeground); }
    .message.status { color: var(--vscode-descriptionForeground); }
    .message.result { color: var(--vscode-debugTokenExpression-value); }
    .search-hit {
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-findMatchHighlightBackground);
      border-radius: 2px;
    }
    .search-hit.current {
      background: var(--vscode-editor-findMatchBackground);
      outline: 2px solid var(--vscode-editor-findMatchBorder, var(--vscode-focusBorder));
      box-shadow:
        0 0 0 1px var(--vscode-editor-background),
        0 0 0 3px var(--vscode-focusBorder);
      color: var(--vscode-editor-foreground);
      font-weight: 700;
    }
    .scroll-markers {
      position: absolute;
      top: 0;
      right: 2px;
      bottom: 0;
      width: 4px;
      pointer-events: none;
    }
    .scroll-marker {
      position: absolute;
      right: 0;
      width: 4px;
      min-height: 3px;
      background: var(--vscode-editorOverviewRuler-findMatchForeground, var(--vscode-editor-findMatchHighlightBackground));
      border-radius: 2px;
    }
    .scroll-marker.current {
      background: var(--vscode-editorOverviewRuler-selectionHighlightForeground, var(--vscode-editor-findMatchBackground));
    }
    .repl {
      display: flex;
      gap: 6px;
      align-items: center;
      padding: 6px 8px;
      border-top: 1px solid var(--vscode-panel-border);
      box-sizing: border-box;
    }
    .prompt {
      color: var(--vscode-descriptionForeground);
      font-family: var(--vscode-editor-font-family);
    }
    input {
      flex: 1;
      min-width: 0;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 2px;
      padding: 4px 6px;
      font: inherit;
      font-family: var(--vscode-editor-font-family);
    }
  </style>
</head>
<body>
  <div class="layout">
    <main class="main">
      <div id="searchBar" class="search-bar">
        <div class="query-input-shell">
          <input id="queryInput" class="query-control search-input" autocomplete="off" spellcheck="false" placeholder="Search">
        </div>
        <span id="searchCount" class="search-count">0/0</span>
        <button id="previousSearchMatch" class="query-icon-button" type="button" title="Previous Match"></button>
        <button id="nextSearchMatch" class="query-icon-button" type="button" title="Next Match"></button>
        <button id="filterToggle" class="query-icon-button" type="button" title="Switch to Filter"></button>
      </div>
      <div class="console-frame">
        <div id="console" class="console"></div>
        <div id="scrollMarkers" class="scroll-markers"></div>
      </div>
      <form id="repl" class="repl">
        <span class="prompt">&gt;</span>
        <input id="input" autocomplete="off" spellcheck="false" placeholder="Evaluate expression">
        <button class="action" type="submit">Evaluate</button>
      </form>
    </main>
    <div id="resizeHandle" class="resize-handle" role="separator" aria-orientation="vertical" title="Resize sessions"></div>
    <aside class="session-rail">
      <div id="tabs" class="tabs" role="tree"></div>
    </aside>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const tabs = document.getElementById('tabs');
    const consoleView = document.getElementById('console');
    const queryInput = document.getElementById('queryInput');
    const searchCount = document.getElementById('searchCount');
    const previousSearchMatch = document.getElementById('previousSearchMatch');
    const nextSearchMatch = document.getElementById('nextSearchMatch');
    const filterToggle = document.getElementById('filterToggle');
    const scrollMarkers = document.getElementById('scrollMarkers');
    const form = document.getElementById('repl');
    const input = document.getElementById('input');
    const resizeHandle = document.getElementById('resizeHandle');
    const sessionRail = document.querySelector('.session-rail');
    const persisted = vscode.getState() || {};
    const iconUris = ${JSON.stringify(iconUris)};
    let collapsedGroups = persisted.collapsedGroups || {};
    let queryMode = persisted.queryMode === 'filter' ? 'filter' : 'search';
    let currentSearchMatchIndex = 0;
    let previousHighlightKey = '';
    let shouldRevealSearchMatch = false;
    if (typeof persisted.sessionRailWidth === 'number') {
      setSessionRailWidth(persisted.sessionRailWidth);
    }
    let state = { sessions: [], activeItemId: undefined };
    let resizeStartX = 0;
    let resizeStartWidth = 0;
    previousSearchMatch.append(createIcon('chevron-up'));
    nextSearchMatch.append(createIcon('chevron-down'));
    filterToggle.append(createIcon('filter'));

    window.addEventListener('message', event => {
      if (event.data.command !== 'state') {
        return;
      }
      if (event.data.focusSearch) {
        setQueryMode('search', { focus: false });
      }
      if (event.data.focusFilter) {
        setQueryMode('filter', { focus: false });
      }
      state = event.data;
      render();
      if (event.data.focusInput) {
        input.focus();
      }
      if (event.data.focusSearch) {
        queryInput.focus();
        queryInput.select();
      }
      if (event.data.focusFilter) {
        queryInput.focus();
        queryInput.select();
      }
    });

    tabs.addEventListener('click', event => {
      const groupButton = event.target.closest('button[data-group]');
      if (groupButton) {
        const group = groupButton.dataset.group;
        collapsedGroups = { ...collapsedGroups, [group]: !collapsedGroups[group] };
        updatePersistedState({ collapsedGroups });
        render();
        return;
      }
      const item = event.target.closest('[data-session-id]');
      if (!item) {
        return;
      }
      vscode.postMessage({ command: 'select', itemId: item.dataset.sessionId });
    });

    tabs.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }
      if (event.target.closest('.inline-action')) {
        return;
      }
      const item = event.target.closest('[data-session-id]');
      if (!item) {
        return;
      }
      event.preventDefault();
      vscode.postMessage({ command: 'select', itemId: item.dataset.sessionId });
    });

    form.addEventListener('submit', event => {
      event.preventDefault();
      const active = findActiveSession();
      if (!active?.connected) {
        return;
      }
      const expression = input.value;
      input.value = '';
      vscode.postMessage({ command: 'evaluate', itemId: state.activeItemId, expression });
    });

    queryInput.addEventListener('input', () => {
      currentSearchMatchIndex = 0;
      shouldRevealSearchMatch = true;
      vscode.postMessage({
        command: queryMode === 'filter' ? 'setFilterQuery' : 'setSearchQuery',
        value: queryInput.value
      });
    });

    previousSearchMatch.addEventListener('click', () => {
      moveSearchMatch(-1);
    });

    nextSearchMatch.addEventListener('click', () => {
      moveSearchMatch(1);
    });

    filterToggle.addEventListener('click', () => {
      setQueryMode(queryMode === 'filter' ? 'search' : 'filter', { focus: true, preserveText: true });
    });

    resizeHandle.addEventListener('mousedown', event => {
      resizeStartX = event.clientX;
      resizeStartWidth = sessionRail.getBoundingClientRect().width;
      resizeHandle.classList.add('dragging');
      document.body.classList.add('resizing');
      window.addEventListener('mousemove', resizeSessions);
      window.addEventListener('mouseup', stopResizeSessions, { once: true });
      event.preventDefault();
    });

    function resizeSessions(event) {
      const nextWidth = resizeStartWidth - (event.clientX - resizeStartX);
      setSessionRailWidth(nextWidth);
    }

    function stopResizeSessions() {
      resizeHandle.classList.remove('dragging');
      document.body.classList.remove('resizing');
      window.removeEventListener('mousemove', resizeSessions);
      updatePersistedState({ sessionRailWidth: sessionRail.getBoundingClientRect().width });
    }

    function setSessionRailWidth(width) {
      const clamped = Math.min(Math.max(width, 160), 420);
      sessionRail.style.flexBasis = clamped + 'px';
    }

    function updatePersistedState(patch) {
      vscode.setState({ ...(vscode.getState() || {}), ...patch });
    }

    function render() {
      const sessions = state.sessions || [];
      const active = findActiveSession();
      const wasNearBottom = isConsoleNearBottom();
      const previousScrollTop = consoleView.scrollTop;
      tabs.replaceChildren(...renderSessionTree(sessions, active));
      input.disabled = !active?.connected;
      renderQueryControls();

      if (!active) {
        consoleView.innerHTML = '<div class="empty">No Go Bench debug sessions yet.</div>';
        return;
      }

      const fragment = document.createDocumentFragment();
      const filterQuery = queryMode === 'filter' ? normalizeQuery(state.filterQuery) : '';
      const highlightTerms = getHighlightTerms();
      const highlightKey = queryMode + ':' + highlightTerms.join('\\u0000');
      if (highlightKey !== previousHighlightKey) {
        previousHighlightKey = highlightKey;
        currentSearchMatchIndex = 0;
        shouldRevealSearchMatch = highlightTerms.length > 0;
      }
      const messages = filterQuery
        ? active.messages.filter(message => matchesFilterQuery(message.text, state.filterQuery))
        : active.messages;
      let previousEndsWithNewline = true;
      let matchIndex = 0;
      for (const message of messages) {
        const span = document.createElement('span');
        const boundary = previousEndsWithNewline || message.text.startsWith('\\n') ? '' : '\\n';
        const candidateText = boundary + message.text;
        span.className = 'message ' + message.kind;
        matchIndex = appendHighlightedText(span, candidateText, highlightTerms, matchIndex);
        fragment.appendChild(span);
        previousEndsWithNewline = message.text.endsWith('\\n');
      }
      consoleView.replaceChildren(fragment);
      const matches = [...consoleView.querySelectorAll('.search-hit')];
      if (matches.length === 0) {
        currentSearchMatchIndex = 0;
      } else if (currentSearchMatchIndex >= matches.length) {
        currentSearchMatchIndex = matches.length - 1;
      }
      renderSearchControls(matches.length);
      renderScrollMarkers(matches);
      const currentMatch = matches[currentSearchMatchIndex];
      if (shouldRevealSearchMatch && currentMatch) {
        currentMatch.classList.add('current');
        currentMatch.scrollIntoView({ block: 'center' });
        shouldRevealSearchMatch = false;
      } else if (wasNearBottom) {
        consoleView.scrollTop = consoleView.scrollHeight;
      } else {
        consoleView.scrollTop = previousScrollTop;
      }
      if (!shouldRevealSearchMatch && currentMatch) {
        currentMatch.classList.add('current');
      }
      updateCurrentScrollMarker();
    }

    function isConsoleNearBottom() {
      return consoleView.scrollHeight - consoleView.scrollTop - consoleView.clientHeight < 24;
    }

    function appendHighlightedText(container, text, terms, startIndex) {
      if (terms.length === 0) {
        container.textContent = text;
        return startIndex;
      }
      const normalizedText = normalizeQuery(text);
      let cursor = 0;
      let matchIndex = startIndex;
      while (cursor < text.length) {
        const match = findNextHighlightMatch(normalizedText, terms, cursor);
        if (!match) {
          container.append(document.createTextNode(text.slice(cursor)));
          break;
        }
        const foundAt = match.index;
        if (foundAt > cursor) {
          container.append(document.createTextNode(text.slice(cursor, foundAt)));
        }
        const hit = document.createElement('mark');
        hit.className = 'search-hit';
        hit.dataset.matchIndex = String(matchIndex);
        hit.textContent = text.slice(foundAt, foundAt + match.length);
        container.append(hit);
        cursor = foundAt + match.length;
        matchIndex += 1;
      }
      return matchIndex;
    }

    function findNextHighlightMatch(normalizedText, terms, startIndex) {
      let nextMatch;
      for (const term of terms) {
        const index = normalizedText.indexOf(term, startIndex);
        if (index === -1) {
          continue;
        }
        if (!nextMatch || index < nextMatch.index || (index === nextMatch.index && term.length > nextMatch.length)) {
          nextMatch = { index, length: term.length };
        }
      }
      return nextMatch;
    }

    function renderSearchControls(matchCount) {
      const showSearchControls = getHighlightTerms().length > 0;
      searchCount.textContent = showSearchControls ? (matchCount === 0 ? '0/0' : (currentSearchMatchIndex + 1) + '/' + matchCount) : '';
      searchCount.style.visibility = showSearchControls ? 'visible' : 'hidden';
      previousSearchMatch.disabled = !showSearchControls || matchCount === 0;
      nextSearchMatch.disabled = !showSearchControls || matchCount === 0;
    }

    function renderScrollMarkers(matches) {
      scrollMarkers.replaceChildren();
      if (getHighlightTerms().length === 0 || matches.length === 0) {
        return;
      }
      const scrollHeight = Math.max(1, consoleView.scrollHeight);
      for (const match of matches) {
        const marker = document.createElement('div');
        marker.className = 'scroll-marker';
        marker.dataset.matchIndex = match.dataset.matchIndex || '';
        marker.style.top = Math.min(99, Math.max(0, (match.offsetTop / scrollHeight) * 100)) + '%';
        scrollMarkers.append(marker);
      }
    }

    function updateCurrentScrollMarker() {
      for (const marker of scrollMarkers.querySelectorAll('.scroll-marker')) {
        marker.classList.toggle('current', marker.dataset.matchIndex === String(currentSearchMatchIndex));
      }
    }

    function moveSearchMatch(direction) {
      if (getHighlightTerms().length === 0) {
        return;
      }
      const matches = consoleView.querySelectorAll('.search-hit');
      if (matches.length === 0) {
        return;
      }
      currentSearchMatchIndex = (currentSearchMatchIndex + direction + matches.length) % matches.length;
      shouldRevealSearchMatch = true;
      render();
    }

    function getHighlightTerms() {
      if (queryMode === 'filter') {
        return parseFilterQuery(state.filterQuery).include;
      }
      const query = normalizeQuery(state.searchQuery);
      return query ? [query] : [];
    }

    function renderQueryControls() {
      const value = queryMode === 'filter' ? state.filterQuery || '' : state.searchQuery || '';
      if (queryInput.value !== value) {
        queryInput.value = value;
      }
      queryInput.placeholder = queryMode === 'filter' ? 'Filter (for example text, !exclude)' : 'Search';
      filterToggle.classList.toggle('active', queryMode === 'filter');
      filterToggle.title = queryMode === 'filter' ? 'Switch to Search' : 'Switch to Filter';
    }

    function setQueryMode(nextMode, options = {}) {
      const text = queryInput.value;
      queryMode = nextMode === 'filter' ? 'filter' : 'search';
      updatePersistedState({ queryMode });
      if (options.preserveText) {
        state = {
          ...state,
          searchQuery: queryMode === 'search' ? text : state.searchQuery,
          filterQuery: queryMode === 'filter' ? text : state.filterQuery
        };
        vscode.postMessage({
          command: queryMode === 'filter' ? 'setFilterQuery' : 'setSearchQuery',
          value: text
        });
      }
      renderQueryControls();
      if (options.focus) {
        queryInput.focus();
        queryInput.select();
      }
    }

    function findActiveSession() {
      const sessions = state.sessions || [];
      return sessions.find(session => session.itemId === state.activeItemId) || sessions[0];
    }

    function renderSessionTree(sessions, active) {
      const running = sessions.filter(session => session.connected);
      const ended = sessions.filter(session => !session.connected);
      return [
        createSessionGroup('Running', running, active),
        createSessionGroup('Ended', ended, active)
      ];
    }

    function createSessionGroup(label, sessions, active) {
      const root = document.createElement('div');
      root.className = 'tree-root';
      const groupKey = label.toLowerCase();
      const collapsed = collapsedGroups[groupKey] === true;
      const header = document.createElement('button');
      header.type = 'button';
      header.className = 'tree-root-label';
      header.dataset.group = groupKey;
      header.title = (collapsed ? 'Expand ' : 'Collapse ') + label;
      header.setAttribute('aria-expanded', String(!collapsed));
      const twistie = document.createElement('span');
      twistie.className = 'tree-root-twistie ' + (collapsed ? 'collapsed' : 'expanded');
      twistie.setAttribute('aria-hidden', 'true');
      const text = document.createElement('span');
      text.className = 'tree-root-text';
      text.textContent = label + ' (' + sessions.length + ')';
      header.append(twistie, text);
      const children = document.createElement('div');
      children.className = 'tree-children';
      children.role = 'group';
      if (!collapsed) {
        children.replaceChildren(...sessions.map(session => createSessionButton(session, active)));
      }
      root.append(header, children);
      return root;
    }

    function createSessionButton(session, active) {
        const item = document.createElement('div');
        item.className = 'tab' + (session.itemId === active?.itemId ? ' active' : '') + (session.connected ? '' : ' disconnected');
        item.dataset.sessionId = session.itemId;
        item.role = 'treeitem';
        item.tabIndex = 0;
        item.title = formatSessionTooltip(session);
        const icon = document.createElement('span');
        icon.className = 'session-icon ' + (session.connected ? 'debugging' : '');
        icon.append(createIcon(session.connected ? 'debug-alt' : session.runnableKind === 'goFile' ? 'go-to-file' : 'package'));
        const title = document.createElement('span');
        title.className = 'tab-title';
        title.textContent = session.title;
        const meta = document.createElement('span');
        meta.className = 'tab-meta';
        meta.textContent = formatSessionMeta(session);
        const actions = document.createElement('span');
        actions.className = 'tab-actions';
        actions.append(...createSessionActions(session));
        item.append(icon, title, meta, actions);
        return item;
    }

    function createSessionActions(session) {
      if (session.connected) {
        return [
          createInlineAction('stop', 'debug-stop', 'Stop'),
          createInlineAction('restart', 'debug-restart', 'Restart'),
          createInlineAction('pause', 'debug-pause', 'Pause'),
          createInlineAction('reveal', 'go-to-file', 'Go to File')
        ].filter(Boolean);
      }
      return [
        session.runnableExists ? createInlineAction('run', 'debug-start', 'Run') : undefined,
        session.runnableExists ? createInlineAction('debug', 'debug-alt', 'Debug') : undefined,
        session.runnableExists ? createInlineAction('reveal', 'go-to-file', 'Go to File') : undefined,
        createInlineAction('deleteEnded', 'trash', 'Delete ended session')
      ].filter(Boolean);
    }

    function createInlineAction(action, iconName, title) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'inline-action';
      button.title = title;
      button.dataset.action = action;
      button.append(createIcon(iconName));
      button.addEventListener('click', event => {
        event.stopPropagation();
        const sessionItem = event.currentTarget.closest('[data-session-id]');
        const itemId = sessionItem?.dataset.sessionId;
        if (!itemId) {
          return;
        }
        if (action === 'deleteEnded') {
          vscode.postMessage({ command: 'deleteEnded', itemId });
          return;
        }
        vscode.postMessage({ command: 'runnableAction', itemId, action });
      });
      return button;
    }

    function createIcon(name) {
      const image = document.createElement('img');
      image.alt = '';
      image.draggable = false;
      image.src = resolveIconUri(name);
      return image;
    }

    function resolveIconUri(name) {
      const theme = document.body.classList.contains('vscode-light') ? 'light' : 'dark';
      return iconUris[theme]?.[name] || iconUris.dark?.[name] || iconUris.light?.[name] || '';
    }

    function formatSessionMeta(session) {
      const duration = formatDuration((session.endedAt || Date.now()) - session.startedAt);
      return session.connected ? 'running ' + duration : 'ended ' + formatTime(session.endedAt) + ' · ' + duration;
    }

    function formatSessionTooltip(session) {
      const parts = [
        session.title,
        'Started: ' + formatDateTime(session.startedAt),
        session.connected ? 'Running: ' + formatDuration(Date.now() - session.startedAt) : 'Ended: ' + formatDateTime(session.endedAt),
        !session.connected ? 'Duration: ' + formatDuration((session.endedAt || Date.now()) - session.startedAt) : undefined
      ];
      return parts.filter(Boolean).join('\\n');
    }

    function formatDuration(milliseconds) {
      const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      if (hours > 0) {
        return hours + 'h ' + minutes + 'm';
      }
      if (minutes > 0) {
        return minutes + 'm ' + seconds + 's';
      }
      return seconds + 's';
    }

    function formatTime(value) {
      return value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'unknown';
    }

    function formatDateTime(value) {
      return value ? new Date(value).toLocaleString() : 'unknown';
    }

    function normalizeQuery(value) {
      return String(value || '').toLowerCase();
    }

    function matchesFilterQuery(text, query) {
      const normalizedText = normalizeQuery(text);
      const filter = parseFilterQuery(query);
      for (const term of filter.exclude) {
        if (normalizedText.includes(term)) {
          return false;
        }
      }
      for (const term of filter.include) {
        if (!normalizedText.includes(term)) {
          return false;
        }
      }
      return true;
    }

    function parseFilterQuery(query) {
      const include = [];
      const exclude = [];
      const terms = String(query || '')
        .split(/[\\s,]+/)
        .map(term => term.trim().toLowerCase())
        .filter(Boolean);
      for (const term of terms) {
        if (term.startsWith('!')) {
          const excluded = term.slice(1);
          if (excluded) {
            exclude.push(excluded);
          }
        } else {
          include.push(term);
        }
      }
      return { include, exclude };
    }

    setInterval(() => {
      if ((state.sessions || []).some(session => session.connected)) {
        render();
      }
    }, 1000);

    vscode.postMessage({ command: 'ready' });
  </script>
</body>
</html>`;
}

function createVscodeIconUris(webview: vscode.Webview, extensionUri: vscode.Uri): Record<string, Record<string, string>> {
  const iconNames = [
    'debug-alt',
    'debug-pause',
    'debug-restart',
    'debug-start',
    'debug-stop',
    'chevron-down',
    'chevron-up',
    'close',
    'filter',
    'go-to-file',
    'package',
    'search',
    'trash'
  ];
  const themes = ['light', 'dark'];
  const iconUris: Record<string, Record<string, string>> = {};
  for (const theme of themes) {
    iconUris[theme] = {};
    for (const iconName of iconNames) {
      iconUris[theme][iconName] = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'media', 'vscode-icons', theme, `${iconName}.svg`)
      ).toString();
    }
  }
  return iconUris;
}

function createNonce(): string {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let index = 0; index < 32; index += 1) {
    value += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return value;
}
