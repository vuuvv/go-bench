/**
 * Go Bench Run and Debug 纯数据模型。
 *
 * 该模块不依赖 VSCode API，负责 runnable 的持久化形状、去重、路径恢复、`go run` 命令文本和
 * Go debug configuration 构造。VSCode 交互层只把 workspace/file picker/terminal/debug adapter 接进来。
 */

import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';

/** 第一阶段支持的 runnable 类型：单个 Go 文件或 Go package 目录。 */
export type GoBenchRunnableKind = 'goFile' | 'goPackage';

/** 持久化到 workspace settings 的 Go Bench runnable 项。 */
export type GoBenchRunnableItem = {
  /** 稳定 ID，由 workspace、类型和 workspace 相对路径派生，重复添加同一目标时用于定位已有项。 */
  id: string;
  /** 侧边栏展示名称，默认来自文件名或目录名，用户可编辑。 */
  label: string;
  /** workspace 内目标使用相对路径；workspace 外目标才使用绝对路径。 */
  uri: string;
  /** 所属 workspace 名称；multi-root 下用于恢复和展示归属。 */
  workspaceFolder: string;
  /** 运行目标类型。 */
  kind: GoBenchRunnableKind;
  /** Go package 名称，用于在 Run and Debug 树中让用户确认目标归属。 */
  packageName?: string;
  /** 用户归档分组 ID；未设置时显示在 Run and Debug 根层级。 */
  groupId?: string;
  /** 运行工作目录；workspace 内使用相对路径，避免把本机绝对路径写入共享设置。 */
  cwd: string;
  /** 传给 `go run` 或 debug adapter 的参数。 */
  args: string[];
  /** 传给 debug adapter 的环境变量；terminal 运行会先写出 export/set 命令。 */
  env?: Record<string, string>;
  /** ISO 时间戳，用于后续排序或审计。 */
  createdAt: string;
  /** ISO 时间戳，编辑或重复添加更新已有项时刷新。 */
  updatedAt: string;
};

/** Run and Debug 树中的用户分组。 */
export type GoBenchRunnableGroup = {
  /** 稳定分组 ID。 */
  id: string;
  /** 侧边栏展示名称。 */
  label: string;
  /** ISO 时间戳，用于后续排序或同步。 */
  createdAt: string;
  /** ISO 时间戳，重命名或修改分组时刷新。 */
  updatedAt: string;
};

/** Run and Debug 根层级展示节点。 */
export type GoBenchRunnableTreeRoot =
  | {
      kind: 'group';
      group: GoBenchRunnableGroup;
      items: GoBenchRunnableItem[];
    }
  | {
      kind: 'item';
      item: GoBenchRunnableItem;
    };

/** VSCode workspace folder 的最小可测试投影。 */
export type RunnableWorkspaceFolder = {
  name: string;
  path: string;
};

/** 创建或更新 runnable 时需要的目标信息。 */
export type RunnableTargetInput = {
  kind: GoBenchRunnableKind;
  path: string;
  workspaceFolder: RunnableWorkspaceFolder;
  label?: string;
  moduleName?: string;
  packageImportPath?: string;
  packageName?: string;
  groupId?: string;
  args?: string[];
  env?: Record<string, string>;
  now?: string;
};

/** 添加 runnable 的结果，用于 UI 决定提示是新增还是更新。 */
export type AddRunnableResult = {
  items: GoBenchRunnableItem[];
  item: GoBenchRunnableItem;
  action: 'added' | 'updated';
};

/** 创建分组的输入。 */
export type RunnableGroupInput = {
  label: string;
  now?: string;
};

/** 可直接交给官方 Go 扩展 debug adapter 的 launch configuration。 */
export type GoBenchRunnableDebugConfiguration = {
  name: string;
  type: 'go';
  request: 'launch';
  mode: 'debug';
  program: string;
  cwd: string;
  args: string[];
  env?: Record<string, string>;
};

/** 构造 workspace 内稳定路径；只有 workspace 外目标保留绝对路径。 */
export function toPersistedPath(path: string, workspaceFolder: RunnableWorkspaceFolder): string {
  const relativePath = relative(workspaceFolder.path, path);
  if (relativePath === '') {
    return '.';
  }
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    return path;
  }
  return relativePath.split(sep).join('/');
}

/** 将持久化路径恢复成当前机器上的绝对路径。 */
export function resolvePersistedPath(path: string, workspaceFolder: RunnableWorkspaceFolder): string {
  if (isAbsolute(path)) {
    return path;
  }
  if (path === '.') {
    return workspaceFolder.path;
  }
  return resolve(workspaceFolder.path, ...path.split('/'));
}

/** 用 workspace、类型和目标相对路径生成稳定 ID，保证重复添加同一目标能命中已有项。 */
export function buildRunnableId(input: Pick<GoBenchRunnableItem, 'workspaceFolder' | 'kind' | 'uri'>): string {
  return `${input.workspaceFolder}:${input.kind}:${input.uri}`;
}

/** 根据目标信息创建默认 runnable。 */
export function createRunnableItem(input: RunnableTargetInput): GoBenchRunnableItem {
  const persistedUri = toPersistedPath(input.path, input.workspaceFolder);
  const cwdPath = input.kind === 'goFile' ? dirname(input.path) : input.path;
  const persistedCwd = toPersistedPath(cwdPath, input.workspaceFolder);
  const now = input.now ?? new Date().toISOString();
  const item = {
    id: buildRunnableId({
      workspaceFolder: input.workspaceFolder.name,
      kind: input.kind,
      uri: persistedUri
    }),
    label: input.label ?? buildRunnableDisplayLabel({
      moduleName: input.moduleName,
      packageImportPath: input.packageImportPath,
      fallback: basename(input.path)
    }),
    uri: persistedUri,
    workspaceFolder: input.workspaceFolder.name,
    kind: input.kind,
    packageName: input.packageName,
    groupId: input.groupId,
    cwd: persistedCwd,
    args: input.args ?? [],
    env: input.env,
    createdAt: now,
    updatedAt: now
  };
  return item;
}

/** 按产品要求生成列表项名称：module name + "/" + package path，末尾 `/main` 可省略。 */
export function buildRunnableDisplayLabel(input: {
  moduleName?: string;
  packageImportPath?: string;
  fallback: string;
}): string {
  if (!input.moduleName) {
    return input.fallback;
  }

  const packageImportPath = trimSlashes(input.packageImportPath ?? '');
  if (packageImportPath === '' || packageImportPath === 'main') {
    return input.moduleName;
  }

  const withoutTrailingMain = packageImportPath.endsWith('/main')
    ? packageImportPath.slice(0, -'/main'.length)
    : packageImportPath;
  return withoutTrailingMain === '' ? input.moduleName : `${input.moduleName}/${withoutTrailingMain}`;
}

/** 添加 runnable；重复目标会保留 createdAt 并更新 label/args/env/cwd。 */
export function addOrUpdateRunnable(
  items: readonly GoBenchRunnableItem[],
  input: RunnableTargetInput
): AddRunnableResult {
  const candidate = createRunnableItem(input);
  const existingIndex = items.findIndex(item => item.id === candidate.id);
  if (existingIndex === -1) {
    return {
      items: [...items, candidate],
      item: candidate,
      action: 'added'
    };
  }

  const existing = items[existingIndex];
  const updated = {
    ...candidate,
    groupId: existing.groupId ?? candidate.groupId,
    createdAt: existing.createdAt,
    updatedAt: candidate.updatedAt
  };
  return {
    items: items.map((item, index) => index === existingIndex ? updated : item),
    item: updated,
    action: 'updated'
  };
}

/** 从列表中删除 runnable；真实文件不会被触碰。 */
export function removeRunnable(items: readonly GoBenchRunnableItem[], id: string): GoBenchRunnableItem[] {
  return items.filter(item => item.id !== id);
}

/** 更新用户可编辑字段，保持 ID 和目标路径稳定。 */
export function editRunnableItem(
  item: GoBenchRunnableItem,
  patch: Partial<Pick<GoBenchRunnableItem, 'label' | 'args' | 'cwd' | 'env' | 'groupId' | 'packageName'>>,
  now = new Date().toISOString()
): GoBenchRunnableItem {
  return {
    ...item,
    ...patch,
    updatedAt: now
  };
}

/** 新建 runnable 分组，ID 从名称和时间戳派生，保证 workspace settings 中稳定可读。 */
export function createRunnableGroup(input: RunnableGroupInput): GoBenchRunnableGroup {
  const now = input.now ?? new Date().toISOString();
  const normalizedLabel = input.label.trim();
  return {
    id: `group:${slugify(normalizedLabel)}:${now}`,
    label: normalizedLabel,
    createdAt: now,
    updatedAt: now
  };
}

/** 将 runnable 归档到指定分组；groupId 为 undefined 时表示移回根层级。 */
export function assignRunnableGroup(
  items: readonly GoBenchRunnableItem[],
  id: string,
  groupId: string | undefined,
  now = new Date().toISOString()
): GoBenchRunnableItem[] {
  return items.map(item => item.id === id ? editRunnableItem(item, { groupId }, now) : item);
}

/** 删除分组时保留项目，只把其中项目移回根层级。 */
export function removeRunnableGroup(
  groups: readonly GoBenchRunnableGroup[],
  items: readonly GoBenchRunnableItem[],
  groupId: string,
  now = new Date().toISOString()
): { groups: GoBenchRunnableGroup[]; items: GoBenchRunnableItem[] } {
  return {
    groups: groups.filter(group => group.id !== groupId),
    items: items.map(item => item.groupId === groupId ? editRunnableItem(item, { groupId: undefined }, now) : item)
  };
}

/** 将扁平持久化数据投影为 Run and Debug 根层级树：分组在前，未分组项目在后。 */
export function buildRunnableTreeRoots(
  items: readonly GoBenchRunnableItem[],
  groups: readonly GoBenchRunnableGroup[]
): GoBenchRunnableTreeRoot[] {
  const groupedItems = new Map<string, GoBenchRunnableItem[]>();
  for (const item of items) {
    if (!item.groupId) {
      continue;
    }
    const children = groupedItems.get(item.groupId) ?? [];
    children.push(item);
    groupedItems.set(item.groupId, children);
  }

  return [
    ...groups.map(group => ({
      kind: 'group' as const,
      group,
      items: sortRunnableItems(groupedItems.get(group.id) ?? [])
    })),
    ...sortRunnableItems(items.filter(item => !item.groupId || !groups.some(group => group.id === item.groupId))).map(item => ({
      kind: 'item' as const,
      item
    }))
  ];
}

/** 从 Go 源码中提取 package 名称；扫描和展示都走同一条逻辑，避免 UI 和模型判断分叉。 */
export function parseGoPackageName(source: string): string | undefined {
  return source.match(/^\s*package\s+([A-Za-z_][A-Za-z0-9_]*)\b/m)?.[1];
}

/** 判断 Go 文件是否是可执行入口；扫描只收录 `package main` 且声明 `func main(...)` 的文件。 */
export function isExecutableGoFileContent(source: string): boolean {
  return parseGoPackageName(source) === 'main' && /^[ \t]*func\s+main\s*\(/m.test(source);
}

/** 为 terminal 展示和执行构造 `go run` 命令文本。 */
export function buildGoRunCommand(
  item: GoBenchRunnableItem,
  workspaceFolder: RunnableWorkspaceFolder,
  goCommand = 'go'
): string {
  const targetPath = resolvePersistedPath(item.uri, workspaceFolder);
  const targetArg = item.kind === 'goFile' ? targetPath : '.';
  return [goCommand, 'run', targetArg, ...item.args].map(shellQuote).join(' ');
}

/** 构造 Go debug launch configuration。 */
export function buildRunnableDebugConfiguration(
  item: GoBenchRunnableItem,
  workspaceFolder: RunnableWorkspaceFolder
): GoBenchRunnableDebugConfiguration {
  const targetPath = resolvePersistedPath(item.uri, workspaceFolder);
  const cwd = resolvePersistedPath(item.cwd, workspaceFolder);
  const configuration: GoBenchRunnableDebugConfiguration = {
    name: item.label,
    type: 'go',
    request: 'launch',
    mode: 'debug',
    program: item.kind === 'goFile' ? targetPath : cwd,
    cwd,
    args: item.args
  };
  if (item.env && Object.keys(item.env).length > 0) {
    configuration.env = item.env;
  }
  return configuration;
}

/** 将逗号或 shell-like 空白输入规整成参数数组；第一阶段保持简单可预测。 */
export function parseRunnableArgs(input: string): string[] {
  return input
    .split(/\s+/)
    .map(value => value.trim())
    .filter(value => value !== '');
}

/** 将 KEY=value 多行输入规整成 env map。 */
export function parseRunnableEnv(input: string): Record<string, string> | undefined {
  const entries = input
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line !== '')
    .map(line => {
      const separatorIndex = line.indexOf('=');
      if (separatorIndex <= 0) {
        return undefined;
      }
      return [line.slice(0, separatorIndex), line.slice(separatorIndex + 1)] as const;
    })
    .filter((entry): entry is readonly [string, string] => entry !== undefined);

  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries);
}

/** shell 展示文本转义，避免空格、引号或参数中的特殊字符让展示命令误导用户。 */
export function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function sortRunnableItems(items: readonly GoBenchRunnableItem[]): GoBenchRunnableItem[] {
  return [...items].sort((left, right) => {
    const labelComparison = left.label.localeCompare(right.label, undefined, { sensitivity: 'base', numeric: true });
    if (labelComparison !== 0) {
      return labelComparison;
    }
    return left.uri.localeCompare(right.uri, undefined, { sensitivity: 'base', numeric: true });
  });
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'group';
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}
