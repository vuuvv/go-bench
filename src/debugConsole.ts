import * as vscode from 'vscode';
import { debugPanelViewIds } from './constants';
import { formatDebugConsoleOutput, formatDebugConsoleSessionTitle, isDapOutputEventMessage } from './debugConsoleModel';

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
  | { command: 'evaluate'; itemId?: string; expression?: string };

const maxEndedDebugConsoles = 100;

export class GoBenchDebugConsolePanel implements vscode.WebviewViewProvider, vscode.Disposable {
  private readonly consoles = new Map<string, GoBenchDebugConsole>();
  private readonly activeConsoleIdsByRunnable = new Map<string, string>();
  private readonly disposables: vscode.Disposable[] = [];
  private view: vscode.WebviewView | undefined;
  private activeItemId: string | undefined;

  public constructor() {
    this.disposables.push(vscode.window.registerWebviewViewProvider(debugPanelViewIds.debugConsole, this, {
      webviewOptions: {
        retainContextWhenHidden: true
      }
    }));
  }

  public getOrCreateConsole(runnableId: string, label: string): GoBenchDebugConsole {
    const activeConsoleId = this.activeConsoleIdsByRunnable.get(runnableId);
    let debugConsole = activeConsoleId ? this.consoles.get(activeConsoleId) : undefined;
    if (debugConsole && !debugConsole.connected) {
      debugConsole = undefined;
      this.activeConsoleIdsByRunnable.delete(runnableId);
    }
    if (!debugConsole) {
      const consoleId = `${runnableId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
      debugConsole = new GoBenchDebugConsole(consoleId, runnableId, label, this);
      this.consoles.set(consoleId, debugConsole);
      this.activeConsoleIdsByRunnable.set(runnableId, consoleId);
      this.activeItemId = consoleId;
      this.postState();
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
      }
    }
    this.activeConsoleIdsByRunnable.delete(runnableId);
    if (this.activeItemId && !this.consoles.has(this.activeItemId)) {
      this.activeItemId = this.selectDefaultActiveItemId();
    }
    this.postState();
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
    if (debugConsole && !debugConsole.connected && this.activeConsoleIdsByRunnable.get(debugConsole.runnableId) === itemId) {
      this.activeConsoleIdsByRunnable.delete(debugConsole.runnableId);
    }
    if (!this.activeItemId || this.consoles.size === 1) {
      this.activeItemId = itemId;
    }
    this.pruneEndedConsoles();
    this.postState();
  }

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = buildDebugConsoleHtml(webviewView.webview);
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

    const itemId = message.itemId ?? this.activeItemId;
    if (!itemId) {
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

  private postState(options: { focusInput?: boolean } = {}): void {
    const view = this.view;
    if (!view) {
      return;
    }

    const sessions = this.sortConsolesForView().map(debugConsole => debugConsole.toSnapshot());
    const activeItemId = this.activeItemId ?? sessions[0]?.itemId;
    void view.webview.postMessage({
      command: 'state',
      activeItemId,
      focusInput: options.focusInput === true,
      sessions
    });
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
      .filter(debugConsole => !debugConsole.connected)
      .sort((left, right) => (right.endedAt ?? 0) - (left.endedAt ?? 0));
    const expired = ended.slice(maxEndedDebugConsoles);
    for (const debugConsole of expired) {
      this.consoles.delete(debugConsole.itemId);
    }
    if (this.activeItemId && !this.consoles.has(this.activeItemId)) {
      this.activeItemId = this.selectDefaultActiveItemId();
    }
  }

  private selectDefaultActiveItemId(): string | undefined {
    return this.sortConsolesForView()[0]?.itemId;
  }
}

export class GoBenchDebugConsole {
  private readonly messages: DebugConsoleMessage[] = [];
  private session: vscode.DebugSession | undefined;
  private endedAtValue: number | undefined;
  public readonly startedAt = Date.now();

  public constructor(
    public readonly itemId: string,
    public readonly runnableId: string,
    private readonly label: string,
    private readonly panel: GoBenchDebugConsolePanel
  ) {}

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
  }

  public matchesSession(session: vscode.DebugSession): boolean {
    return this.session === session;
  }

  public get connected(): boolean {
    return Boolean(this.session);
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

  public toSnapshot(): {
    itemId: string;
    title: string;
    connected: boolean;
    startedAt: number;
    endedAt?: number;
    messages: DebugConsoleMessage[];
  } {
    return {
      itemId: this.itemId,
      title: formatDebugConsoleSessionTitle(this.label),
      connected: this.connected,
      startedAt: this.startedAt,
      endedAt: this.endedAtValue,
      messages: [...this.messages]
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
    this.messages.push({ kind, text });
    this.panel.notifyChanged(this.itemId);
  }
}

export function resolveActiveDebugFrameId(session: vscode.DebugSession): number | undefined {
  const activeStackItem = vscode.debug.activeStackItem;
  if (!activeStackItem || activeStackItem.session !== session || !('frameId' in activeStackItem)) {
    return undefined;
  }
  return activeStackItem.frameId;
}

function buildDebugConsoleHtml(webview: vscode.Webview): string {
  const nonce = createNonce();
  const cspSource = webview.cspSource;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
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
    .session-rail {
      display: flex;
      flex: 0 0 220px;
      min-width: 160px;
      max-width: 280px;
      flex-direction: column;
      gap: 6px;
      padding: 8px;
      border-left: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBar-background);
      box-sizing: border-box;
    }
    .tree-group {
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      text-transform: uppercase;
      padding: 4px 4px 2px;
    }
    .tabs {
      display: flex;
      flex: 1;
      min-height: 0;
      flex-direction: column;
      gap: 2px;
      overflow-y: auto;
    }
    .tab {
      border: 0;
      color: var(--vscode-foreground);
      background: transparent;
      width: 100%;
      min-height: 28px;
      padding: 5px 8px;
      border-radius: 3px;
      cursor: pointer;
      font: inherit;
      text-align: left;
      overflow: hidden;
    }
    .tab.active {
      background: var(--vscode-list-activeSelectionBackground);
      color: var(--vscode-list-activeSelectionForeground);
    }
    .tab.disconnected {
      color: var(--vscode-descriptionForeground);
    }
    .tab-title {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tab-meta {
      display: block;
      margin-top: 2px;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
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
    .console {
      flex: 1;
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
      <div id="console" class="console"></div>
      <form id="repl" class="repl">
        <span class="prompt">&gt;</span>
        <input id="input" autocomplete="off" spellcheck="false" placeholder="Evaluate expression">
        <button class="action" type="submit">Evaluate</button>
      </form>
    </main>
    <aside class="session-rail">
      <div id="tabs" class="tabs"></div>
      <button id="clear" class="action secondary" type="button">Clear</button>
    </aside>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const tabs = document.getElementById('tabs');
    const consoleView = document.getElementById('console');
    const form = document.getElementById('repl');
    const input = document.getElementById('input');
    const clear = document.getElementById('clear');
    let state = { sessions: [], activeItemId: undefined };

    window.addEventListener('message', event => {
      if (event.data.command !== 'state') {
        return;
      }
      state = event.data;
      render();
      if (event.data.focusInput) {
        input.focus();
      }
    });

    tabs.addEventListener('click', event => {
      const button = event.target.closest('button[data-id]');
      if (!button) {
        return;
      }
      vscode.postMessage({ command: 'select', itemId: button.dataset.id });
    });

    clear.addEventListener('click', () => {
      vscode.postMessage({ command: 'clear', itemId: state.activeItemId });
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

    function render() {
      const sessions = state.sessions || [];
      const active = findActiveSession();
      tabs.replaceChildren(...renderSessionTree(sessions, active));
      clear.disabled = !active;
      input.disabled = !active?.connected;

      if (!active) {
        consoleView.innerHTML = '<div class="empty">No Go Bench debug sessions yet.</div>';
        return;
      }

      const fragment = document.createDocumentFragment();
      for (const message of active.messages) {
        const span = document.createElement('span');
        span.className = 'message ' + message.kind;
        span.textContent = message.text;
        fragment.appendChild(span);
      }
      consoleView.replaceChildren(fragment);
      consoleView.scrollTop = consoleView.scrollHeight;
    }

    function findActiveSession() {
      const sessions = state.sessions || [];
      return sessions.find(session => session.itemId === state.activeItemId) || sessions[0];
    }

    function renderSessionTree(sessions, active) {
      const running = sessions.filter(session => session.connected);
      const ended = sessions.filter(session => !session.connected);
      const nodes = [];
      nodes.push(createGroup('Running', running.length));
      nodes.push(...running.map(session => createSessionButton(session, active)));
      nodes.push(createGroup('Ended', ended.length));
      nodes.push(...ended.map(session => createSessionButton(session, active)));
      return nodes;
    }

    function createGroup(label, count) {
      const element = document.createElement('div');
      element.className = 'tree-group';
      element.textContent = label + ' (' + count + ')';
      return element;
    }

    function createSessionButton(session, active) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'tab' + (session.itemId === active?.itemId ? ' active' : '') + (session.connected ? '' : ' disconnected');
        button.dataset.id = session.itemId;
        button.title = formatSessionTooltip(session);
        const title = document.createElement('span');
        title.className = 'tab-title';
        title.textContent = session.title;
        const meta = document.createElement('span');
        meta.className = 'tab-meta';
        meta.textContent = formatSessionMeta(session);
        button.append(title, meta);
        return button;
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

function createNonce(): string {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let index = 0; index < 32; index += 1) {
    value += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return value;
}
