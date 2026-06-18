/**
 * VSCode Testing API 原型使用的测试树模型。
 *
 * 该模块不依赖 VSCode API，只把 parser 的结果转换成稳定的树节点：测试函数是根节点，table case
 * 是子节点，节点携带可直接传给 runner 的 `GoTestRunTarget`。真实 Testing API 适配层只负责把这些
 * 纯数据映射成 `TestItem`，避免 UI 原型和识别逻辑耦合。
 */

import { dirname } from 'node:path';
import type { GoTestFileParseResult, SourceRange } from './parser';
import type { GoTestRunTarget } from './runner';
import type { TableTestConfig } from './tableTestConfig';

/** Testing API 树节点类型。 */
export type GoTestTreeNodeKind = 'function' | 'case';

/** 可映射为 VSCode `TestItem` 的纯数据节点。 */
export type GoTestTreeNode = {
  /** 稳定节点 ID，用于 TestController item 和运行请求回查。 */
  id: string;
  /** 展示给用户的节点名。 */
  label: string;
  /** 节点类型，帮助适配层区分函数和 case。 */
  kind: GoTestTreeNodeKind;
  /** 节点锚定源码范围。 */
  range: SourceRange;
  /** 点击测试树运行时复用的 runner 目标。 */
  runTarget: GoTestRunTarget;
  /** table case 子节点；case 节点当前没有子节点。 */
  children: GoTestTreeNode[];
};

/**
 * 从 parser 输出生成 Testing API 树。
 *
 * 原型阶段与 CodeLens 使用相同的显示开关：函数级运行关闭时不创建函数节点，case 级运行关闭时不
 * 创建子 case。这样用户可以比较两套 UX，同时避免 Testing API 暴露 CodeLens 中已隐藏的能力。
 */
export function createGoTestTreeNodes(
  parseResult: GoTestFileParseResult,
  config: Pick<TableTestConfig, 'showFunctionRun' | 'showCaseRun'>
): GoTestTreeNode[] {
  if (!config.showFunctionRun) {
    return [];
  }

  return parseResult.testFunctions.map(testFunction => {
    const functionTarget: GoTestRunTarget = {
      file: testFunction.file,
      packageDir: dirname(testFunction.file),
      testName: testFunction.name,
      subtestPath: [],
      label: testFunction.name
    };

    return {
      id: createGoTestTreeNodeId(testFunction.file, testFunction.name),
      label: testFunction.name,
      kind: 'function',
      range: testFunction.nameRange,
      runTarget: functionTarget,
      children: config.showCaseRun
        ? testFunction.tableCases.map(tableCase => ({
            id: createGoTestTreeNodeId(tableCase.file, tableCase.testName, tableCase.subtestPath),
            label: tableCase.subtestName,
            kind: 'case' as const,
            range: tableCase.range,
            runTarget: {
              file: tableCase.file,
              packageDir: dirname(tableCase.file),
              testName: tableCase.testName,
              subtestPath: tableCase.subtestPath,
              label: tableCase.label
            },
            children: []
          }))
        : []
    };
  });
}

/** 构造 Testing API 节点稳定 ID。 */
export function createGoTestTreeNodeId(file: string, testName: string, subtestPath: readonly string[] = []): string {
  return ['go-plus', file, testName, ...subtestPath].map(encodeURIComponent).join('/');
}
