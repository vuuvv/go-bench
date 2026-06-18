/**
 * Go helper 驱动的 parser 实现。
 *
 * wrapper 的职责是处理 VSCode extension host 侧的工程问题：过滤非 `_test.go` 文件、把 helper
 * 写入临时目录、通过 stdin 传递未保存源码，并把 helper 的 JSON 输出收敛成稳定 TypeScript 类型。
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { spawn } from 'node:child_process';
import { defaultTableTestConfig } from '../constants';
import { goParserHelperSource } from './helperSource';
import type { GoTestFileParseResult, GoTestParser } from './types';

let helperPathPromise: Promise<string> | undefined;

/** Go helper parser 的运行参数，测试可以注入较短 timeout 或替代 `go` 可执行文件。 */
export type GoHelperParserOptions = {
  /** Go 命令路径，默认使用 PATH 中的 `go`。 */
  goCommand?: string;
  /** 单次解析超时时间，避免 helper 异常时卡住 Extension Host。 */
  timeoutMs?: number;
  /** 可作为 table case 名称的字段名，默认与扩展配置保持一致。 */
  nameFields?: string[];
};

/** 使用 Go 官方 parser helper 解析 `_test.go` 文件。 */
export class GoHelperParser implements GoTestParser {
  private readonly goCommand: string;
  private readonly timeoutMs: number;
  private readonly nameFields: string[];

  /** 创建 helper parser；默认配置适合 VSCode 交互式解析，测试可按需覆盖。 */
  public constructor(options: GoHelperParserOptions = {}) {
    this.goCommand = options.goCommand ?? 'go';
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.nameFields = options.nameFields ?? [...defaultTableTestConfig.nameFields];
  }

  /**
   * 解析 Go 测试文件文本。
   *
   * 非 `_test.go` 文件直接返回空结果，这个保护放在 TypeScript 层而不是 helper 层，是为了避免普通
   * Go 文件编辑时产生额外子进程开销。
   */
  public async parseTestFile(file: string, source: string): Promise<GoTestFileParseResult> {
    if (!isGoTestFile(file)) {
      return emptyParseResult(file);
    }

    const helperPath = await ensureHelperFile();
    const payload = JSON.stringify({ fileName: file, source, nameFields: this.nameFields });
    const stdout = await runHelper(this.goCommand, helperPath, payload, this.timeoutMs);
    return JSON.parse(stdout) as GoTestFileParseResult;
  }
}

/** 判断文件是否是 Go 测试文件，集中给 parser、CodeLens provider 复用。 */
export function isGoTestFile(file: string): boolean {
  return basename(file).endsWith('_test.go');
}

function emptyParseResult(file: string): GoTestFileParseResult {
  return {
    file,
    packageName: '',
    testFunctions: [],
    diagnostics: []
  };
}

async function ensureHelperFile(): Promise<string> {
  helperPathPromise ??= writeHelperFile();
  return helperPathPromise;
}

async function writeHelperFile(): Promise<string> {
  const hash = createHash('sha256').update(goParserHelperSource).digest('hex').slice(0, 12);
  const dir = join(tmpdir(), 'go-bench-parser');
  const file = join(dir, `parser-helper-${hash}.go`);

  // helper 源码按内容 hash 命名；重复解析会复用同一个文件，减少临时目录写入和 `go run` 缓存抖动。
  await mkdir(dir, { recursive: true });
  await writeFile(file, goParserHelperSource, 'utf8');
  return file;
}

async function runHelper(goCommand: string, helperPath: string, payload: string, timeoutMs: number): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn(goCommand, ['run', helperPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    // 子进程超时会影响 Extension Host 响应性，因此显式 kill 并返回可诊断错误。
    const timer = setTimeout(() => {
      settled = true;
      child.kill();
      reject(new Error(`Go parser helper timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', error => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', code => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);

      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(new Error(`Go parser helper exited with code ${code ?? 'unknown'}: ${stderr.trim()}`));
    });

    child.stdin.end(payload);
  });
}
