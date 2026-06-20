export type DapOutputCategory = 'console' | 'stdout' | 'stderr' | 'telemetry' | 'important' | string;

export type DapOutputEventMessage = {
  type?: string;
  event?: string;
  body?: {
    category?: DapOutputCategory;
    output?: string;
    source?: {
      name?: string;
      path?: string;
    };
    line?: number;
    column?: number;
  };
};

export function isDapOutputEventMessage(message: unknown): message is DapOutputEventMessage {
  if (!message || typeof message !== 'object') {
    return false;
  }
  const candidate = message as { type?: unknown; event?: unknown; body?: unknown };
  return candidate.type === 'event' && candidate.event === 'output' && typeof candidate.body === 'object';
}

export function formatDebugConsoleOutput(message: DapOutputEventMessage): string {
  const body = message.body ?? {};
  if (body.category === 'telemetry') {
    return '';
  }

  const output = normalizeOutputViewNewlines(body.output ?? '');
  const sourceSuffix = formatDebugOutputSource(body.source?.path ?? body.source?.name, body.line, body.column);
  const text = sourceSuffix ? `${trimTrailingNewline(output)}${sourceSuffix}${output.endsWith('\n') ? '\n' : ''}` : output;

  if (body.category === 'stderr') {
    return formatCategoryOutput('stderr', text);
  }
  if (body.category === 'important') {
    return formatCategoryOutput('important', text);
  }
  if (body.category && body.category !== 'stdout' && body.category !== 'console') {
    return formatCategoryOutput(body.category, text);
  }
  return text;
}

export function normalizeOutputViewNewlines(value: string): string {
  return value.replace(/\r?\n/g, '\n');
}

export function formatDebugConsoleSessionTitle(label: string): string {
  return label;
}

function formatDebugOutputSource(source: string | undefined, line: number | undefined, column: number | undefined): string {
  if (!source) {
    return '';
  }
  const lineSuffix = line === undefined ? '' : column === undefined ? `:${line}` : `:${line}:${column}`;
  return ` (${source}${lineSuffix})`;
}

function trimTrailingNewline(value: string): string {
  return value.replace(/\n+$/g, '');
}

function formatCategoryOutput(category: string, value: string): string {
  if (!value) {
    return '';
  }
  return `[${category}] ${value}`;
}
