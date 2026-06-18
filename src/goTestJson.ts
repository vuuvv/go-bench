/**
 * `go test -json` 事件解析工具。
 *
 * Testing API 需要把 Go 标准工具链输出映射回 Test Explorer 的单个节点。这里保持纯函数和轻量
 * stream parser，避免 VSCode 适配层直接处理 JSON 细节，也便于用普通单元测试覆盖子测试状态映射。
 */

import type { GoTestRunTarget } from './runner';
import { rewriteGoTestName } from './runner';

/** Go test JSON 中与测试状态相关的动作。 */
export type GoTestJsonAction = 'run' | 'pause' | 'cont' | 'pass' | 'fail' | 'skip' | 'output' | string;

/** `go test -json` 单行事件。字段保持 Go 工具链原名，便于和官方输出对应。 */
export type GoTestJsonEvent = {
  Time?: string;
  Action: GoTestJsonAction;
  Package?: string;
  Test?: string;
  Output?: string;
  Elapsed?: number;
};

/**
 * 流式解析 stdout chunk。
 *
 * Go 每个 JSON event 占一行，但 Node chunk 边界可能落在任意位置，因此需要缓存半行。无法解析的行
 * 作为 raw line 交给调用方写入 Test Results，避免工具链输出丢失。
 */
export class GoTestJsonStreamParser {
  private buffered = '';

  /** 推入一段 stdout，并返回已经完整解析的事件或原始行。 */
  public push(chunk: string): GoTestJsonStreamRecord[] {
    this.buffered += chunk;
    const lines = this.buffered.split(/\r?\n/);
    this.buffered = lines.pop() ?? '';
    return lines.flatMap(line => parseGoTestJsonLine(line));
  }

  /** 返回进程结束时剩余的半行；正常 JSON 输出通常为空。 */
  public flush(): GoTestJsonStreamRecord[] {
    if (this.buffered.length === 0) {
      return [];
    }
    const line = this.buffered;
    this.buffered = '';
    return parseGoTestJsonLine(line);
  }
}

/** stream parser 的输出记录。 */
export type GoTestJsonStreamRecord =
  | {
      kind: 'event';
      event: GoTestJsonEvent;
    }
  | {
      kind: 'raw';
      line: string;
    };

/** 将一整段 stdout 解析为 JSON event，主要供测试和兜底逻辑使用。 */
export function parseGoTestJsonOutput(output: string): GoTestJsonStreamRecord[] {
  const parser = new GoTestJsonStreamParser();
  return [...parser.push(output), ...parser.flush()];
}

/**
 * 构造 Go JSON 事件中的 `Test` 字段值。
 *
 * 该值使用 Go testing 的名称改写规则：空白变 `_`，名称中的 `/` 会展开为层级路径。Testing API
 * 用它把 `TestNormalize/case_one` 事件稳定映射回已注册的 `TestItem`。
 */
export function buildGoTestJsonTestName(target: Pick<GoTestRunTarget, 'testName' | 'subtestPath'>): string {
  return [target.testName, ...target.subtestPath]
    .flatMap(segment => rewriteGoTestName(segment).split('/'))
    .join('/');
}

function parseGoTestJsonLine(line: string): GoTestJsonStreamRecord[] {
  if (line.length === 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(line) as Partial<GoTestJsonEvent>;
    if (typeof parsed.Action !== 'string') {
      return [{ kind: 'raw', line }];
    }
    return [
      {
        kind: 'event',
        event: {
          ...parsed,
          Action: parsed.Action
        }
      }
    ];
  } catch {
    return [{ kind: 'raw', line }];
  }
}
