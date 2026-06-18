/**
 * Go module 目录解析。
 *
 * Test Explorer 树需要以有效 Go module 为第一层结构节点。这里从测试文件目录向上寻找最近的
 * `go.mod`，并解析其中的 module path，保持 VSCode 适配层只负责展示和刷新。
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';

export type GoModuleInfo = {
  /** go.mod 所在目录。 */
  dir: string;
  /** go.mod 中声明的 module path。 */
  name: string;
};

/** 从文件路径向上查找最近的 go.mod 并解析 module path。 */
export function resolveGoModuleInfo(file: string): GoModuleInfo | undefined {
  let current = dirname(file);
  const root = parse(current).root;

  while (true) {
    const goMod = join(current, 'go.mod');
    if (existsSync(goMod)) {
      const moduleName = parseGoModuleName(readFileSync(goMod, 'utf8'));
      return moduleName ? { dir: current, name: moduleName } : undefined;
    }

    if (current === root) {
      return undefined;
    }
    current = dirname(current);
  }
}

/** 解析 go.mod 的 module 声明。 */
export function parseGoModuleName(goModText: string): string | undefined {
  for (const line of goModText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('//')) {
      continue;
    }
    const match = /^module\s+(\S+)/.exec(trimmed);
    if (!match) {
      continue;
    }
    const moduleName = unquoteModuleName(match[1]?.trim() ?? '');
    return moduleName && !moduleName.startsWith('//') ? moduleName : undefined;
  }
  return undefined;
}

function unquoteModuleName(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  if (value.length >= 2 && value.startsWith('`') && value.endsWith('`')) {
    return value.slice(1, -1);
  }
  return value;
}
