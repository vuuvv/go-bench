/**
 * VSCode Testing API 原型使用的测试树模型。
 *
 * 该模块不依赖 VSCode API，只把 parser 的结果转换成稳定的树节点：Go module 是根层级，module
 * 内的目录节点下再挂文件、测试函数和 table case。可执行节点携带可直接传给 runner 的
 * `GoTestRunTarget`。
 * 真实 Testing API 适配层只负责把这些纯数据映射成 `TestItem`，避免 UI 原型和识别逻辑耦合。
 */

import { basename, dirname, isAbsolute, relative, sep } from 'node:path';
import type { GoTestFileParseResult, SourceRange } from './parser';
import type { GoTestRunTarget } from './runner';
import type { TableTestConfig } from './tableTestConfig';

/** Testing API 树节点类型。 */
export type GoTestTreeNodeKind = 'module' | 'package' | 'file' | 'function' | 'case';

/** 可映射为 VSCode `TestItem` 的纯数据节点。 */
export type GoTestTreeNode = {
  /** 稳定节点 ID，用于 TestController item 和运行请求回查。 */
  id: string;
  /** 展示给用户的节点名。 */
  label: string;
  /** 节点类型，帮助适配层区分结构节点和可运行节点。 */
  kind: GoTestTreeNodeKind;
  /** 节点关联文件；结构节点可以只提供目录 URI。 */
  file?: string;
  /** 节点锚定源码范围；package 和 file 结构节点不需要范围。 */
  range?: SourceRange;
  /** 点击测试树运行时复用的 runner 目标；只有 function 和 case 节点可运行。 */
  runTarget?: GoTestRunTarget;
  /** 子节点；case 节点当前没有子节点。 */
  children: GoTestTreeNode[];
};

export type GoTestTreeNodeOptions = {
  /** go.mod 所在目录，用于作为 module 下级目录标签的相对路径基准。 */
  moduleDir: string;
  /** go.mod 中声明的 module path，用作 module 节点展示名。 */
  moduleName: string;
};

/**
 * 从 parser 输出生成 Testing API 树。
 *
 * 原型阶段与 CodeLens 使用相同的显示开关：函数级运行关闭时不创建函数节点，case 级运行关闭时不
 * 创建子 case。这样用户可以比较两套 UX，同时避免 Testing API 暴露 CodeLens 中已隐藏的能力。
 */
export function createGoTestTreeNodes(
  parseResult: GoTestFileParseResult,
  config: Pick<TableTestConfig, 'showFunctionRun' | 'showCaseRun' | 'testingApiTreeMode'>,
  options: GoTestTreeNodeOptions
): GoTestTreeNode[] {
  if (!config.showFunctionRun) {
    return [];
  }

  const fileNodeChildren: GoTestTreeNode[] = parseResult.testFunctions.map(testFunction => {
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
      kind: 'function' as const,
      file: testFunction.file,
      range: testFunction.nameRange,
      runTarget: functionTarget,
      children: shouldShowCaseNodes(config)
        ? testFunction.tableCases.map(tableCase => ({
            id: createGoTestTreeNodeId(tableCase.file, tableCase.testName, tableCase.subtestPath),
            label: tableCase.subtestName,
            kind: 'case' as const,
            file: tableCase.file,
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

  if (fileNodeChildren.length === 0) {
    return [];
  }

  const packageDir = dirname(parseResult.file);
  return [
    {
      id: createGoTestModuleNodeId(options.moduleDir),
      label: options.moduleName,
      kind: 'module',
      file: options.moduleDir,
      children: [
        {
          id: createGoTestPackageNodeId(packageDir),
          label: createPackageNodeLabel(packageDir, options.moduleDir),
          kind: 'package',
          file: packageDir,
          children: [
            {
              id: createGoTestFileNodeId(parseResult.file),
              label: basename(parseResult.file),
              kind: 'file',
              file: parseResult.file,
              children: fileNodeChildren
            }
          ]
        }
      ]
    }
  ];
}

/** 构造 Testing API 节点稳定 ID。 */
export function createGoTestTreeNodeId(file: string, testName: string, subtestPath: readonly string[] = []): string {
  return ['go-bench', 'test', file, testName, ...subtestPath].map(encodeURIComponent).join('/');
}

/** 构造 Go module 结构节点稳定 ID。 */
export function createGoTestModuleNodeId(moduleDir: string): string {
  return ['go-bench', 'module', moduleDir].map(encodeURIComponent).join('/');
}

/** 构造 package/directory 结构节点稳定 ID。 */
export function createGoTestPackageNodeId(packageDir: string): string {
  return ['go-bench', 'package', packageDir].map(encodeURIComponent).join('/');
}

/** 构造 `_test.go` 文件结构节点稳定 ID。 */
export function createGoTestFileNodeId(file: string): string {
  return ['go-bench', 'file', file].map(encodeURIComponent).join('/');
}

function createPackageNodeLabel(packageDir: string, moduleDir: string): string {
  const relativeDir = relative(moduleDir, packageDir);
  if (relativeDir === '') {
    return '.';
  }
  if (relativeDir.startsWith('..') || isAbsolute(relativeDir)) {
    return packageDir;
  }
  return relativeDir.split(sep).join('/');
}

function shouldShowCaseNodes(
  config: Pick<TableTestConfig, 'showCaseRun' | 'testingApiTreeMode'>
): boolean {
  return config.testingApiTreeMode === 'goBench' && config.showCaseRun;
}
