/**
 * parser 模块的共享数据结构。
 *
 * 本阶段只暴露测试函数级元数据，不提前承诺 table case 结构。位置全部使用 VSCode 兼容的
 * zero-based line/character，后续 CodeLens、locator 和 Testing API 都可以直接复用。
 */

/** VSCode 兼容的源码位置，`character` 使用 UTF-16 code unit 计数。 */
export type SourcePosition = {
  /** zero-based 行号。 */
  line: number;
  /** zero-based 字符位置，遵循 VSCode `Position.character` 语义。 */
  character: number;
};

/** VSCode 兼容的源码范围，结束位置遵循半开区间语义。 */
export type SourceRange = {
  /** 范围起点。 */
  start: SourcePosition;
  /** 范围终点。 */
  end: SourcePosition;
};

/** Go parser 返回的诊断信息，用于记录语法未完成等可恢复问题。 */
export type ParserDiagnostic = {
  /** 人类可读的诊断文本，直接来自 Go parser 或 wrapper。 */
  message: string;
  /** 能定位时提供 zero-based 行号。 */
  line?: number;
  /** 能定位时提供 zero-based 字符位置。 */
  character?: number;
  /** 诊断严重级别；语法错误在本阶段统一视为 error，但不会打断扩展。 */
  severity: 'error' | 'warning';
};

/** 已识别的 Go 测试函数元数据。 */
export type GoTestFunctionMetadata = {
  /** 测试函数名，例如 `TestNormalize`。 */
  name: string;
  /** 函数所在文件路径，保持调用方传入的文件名，便于后续 URI 映射。 */
  file: string;
  /** 函数声明到函数体结束的源码范围。 */
  range: SourceRange;
  /** 函数名本身的源码范围，后续 CodeLens 或跳转可以使用更精确锚点。 */
  nameRange: SourceRange;
};

/** 单个 Go 测试文件的解析结果。 */
export type GoTestFileParseResult = {
  /** 被解析的文件路径。 */
  file: string;
  /** Go package 名称；语法严重损坏时可能为空字符串。 */
  packageName: string;
  /** 当前文件中可安全识别的 `func Test...(t *testing.T)` 函数。 */
  testFunctions: GoTestFunctionMetadata[];
  /** 可恢复诊断；存在诊断时仍可能返回部分 AST 结果。 */
  diagnostics: ParserDiagnostic[];
};

/** parser 抽象入口，后续可替换 TypeScript parser 或预编译 Go helper。 */
export interface GoTestParser {
  /**
   * 解析 `_test.go` 文件文本并返回测试函数元数据。
   *
   * 调用方传入文本而不是只传路径，是为了支持 VSCode 未保存 buffer；如果文件名不是 `_test.go`，
   * 实现应返回空结果，避免在普通 Go 文件里制造测试入口噪声。
   */
  parseTestFile(file: string, source: string): Promise<GoTestFileParseResult>;
}
