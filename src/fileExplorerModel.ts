/**
 * Go Bench Files 视图中不依赖 VSCode API 的小型模型工具。
 */

export type FileExplorerEntry = {
  name: string;
  isDirectory: boolean;
};

/** 目录优先，其次按名称稳定排序。 */
export function sortFileExplorerEntries(entries: FileExplorerEntry[]): FileExplorerEntry[] {
  return [...entries].sort((left, right) => {
    if (left.isDirectory !== right.isDirectory) {
      return left.isDirectory ? -1 : 1;
    }
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base', numeric: true });
  });
}

/** 将用户输入的相对路径拆成可安全传给 Uri.joinPath 的片段。 */
export function splitRelativePathInput(input: string): string[] {
  return input
    .trim()
    .split('/')
    .map(segment => segment.trim())
    .filter(segment => segment !== '');
}

/** 文件树第一阶段不接受绝对路径、返回上级目录或 Windows 盘符。 */
export function isSafeRelativePathInput(input: string): boolean {
  const trimmed = input.trim();
  if (trimmed === '' || trimmed.startsWith('/') || trimmed.startsWith('\\') || /^[A-Za-z]:/.test(trimmed)) {
    return false;
  }

  return splitRelativePathInput(trimmed).every(segment => segment !== '.' && segment !== '..' && !segment.includes('\\'));
}

/** 重命名只接受当前目录下的新名称，不承担移动文件职责。 */
export function isSafeSingleNameInput(input: string): boolean {
  return isSafeRelativePathInput(input) && splitRelativePathInput(input).length === 1;
}
