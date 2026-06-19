/**
 * Go main 函数 CodeLens 目标生成。
 *
 * 这里只做轻量静态识别：文件必须是 `package main`，并且声明顶层 `func main(...)`。生成的目标复用
 * Run and Debug runnable 数据模型，因此从编辑器 CodeLens 启动的程序和侧边栏运行目标共享同一套命令。
 */

import { dirname } from 'node:path';
import type { SourceRange } from './parser';
import {
  createRunnableItem,
  isExecutableGoFileContent,
  parseGoPackageName,
  type GoBenchRunnableItem,
  type RunnableWorkspaceFolder
} from './runnablesModel';

/** main 函数 CodeLens 入口描述。 */
export type GoMainCodeLensTarget = {
  /** 展示在 main 函数上方的 CodeLens 标题。 */
  title: 'Run Main' | 'Debug Main';
  /** CodeLens 锚定到 `func main` 声明。 */
  range: SourceRange;
  /** 入口类型，provider 据此选择 runnable run/debug 命令。 */
  kind: 'run' | 'debug';
  /** 传给 runnable 命令的临时运行目标。 */
  runnable: GoBenchRunnableItem;
};

/** 生成可执行 main 文件上的 run/debug CodeLens。 */
export function createGoMainCodeLensTargets(input: {
  file: string;
  source: string;
  workspaceFolder: RunnableWorkspaceFolder;
  label?: string;
  moduleName?: string;
  packageImportPath?: string;
}): GoMainCodeLensTarget[] {
  if (!isExecutableGoFileContent(input.source)) {
    return [];
  }

  const range = findMainFunctionRange(input.source);
  if (!range) {
    return [];
  }

  const runnable = createRunnableItem({
    kind: 'goFile',
    path: input.file,
    workspaceFolder: input.workspaceFolder,
    label: input.label,
    moduleName: input.moduleName,
    packageImportPath: input.packageImportPath,
    packageName: parseGoPackageName(input.source),
    now: 'codelens'
  });

  return [
    {
      title: 'Run Main',
      range,
      kind: 'run',
      runnable
    },
    {
      title: 'Debug Main',
      range,
      kind: 'debug',
      runnable
    }
  ];
}

/** 在源码文本中定位 `func main` 的行列范围。 */
export function findMainFunctionRange(source: string): SourceRange | undefined {
  const match = /^([ \t]*)func\s+main\s*\(/m.exec(source);
  if (!match) {
    return undefined;
  }

  const prefix = source.slice(0, match.index);
  const line = prefix.split(/\r?\n/).length - 1;
  const previousLineBreak = Math.max(prefix.lastIndexOf('\n'), prefix.lastIndexOf('\r'));
  const lineStartIndex = previousLineBreak === -1 ? 0 : previousLineBreak + 1;
  const indentLength = match[1]?.length ?? 0;
  const character = match.index - lineStartIndex + indentLength;
  const endCharacter = character + match[0].slice(indentLength).length;

  return {
    start: { line, character },
    end: { line, character: endCharacter }
  };
}

/** 未找到 go.mod 时兜底使用 workspace 名称和文件目录，避免 CodeLens 目标缺失 cwd。 */
export function createFallbackMainRunnableWorkspace(file: string, workspaceFolder: RunnableWorkspaceFolder): RunnableWorkspaceFolder {
  return {
    name: workspaceFolder.name,
    path: workspaceFolder.path || dirname(file)
  };
}
