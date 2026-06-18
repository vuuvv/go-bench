/**
 * Go table-driven test CodeLens provider。
 *
 * provider 负责把 parser 的结构化结果转换成 VSCode 编辑器里的运行入口：函数级入口锚定函数名，
 * case 级入口锚定 table entry。解析失败或用户正在输入不完整代码时只记录到 output channel，
 * 不在编辑器里制造噪声，符合产品对未完成编辑状态的容错要求。
 */

import * as vscode from 'vscode';
import { commands, configurationKeys } from './constants';
import { createGoTestCodeLensTargets } from './codelensTargets';
import { GoHelperParser, isGoTestFile } from './parser';
import type { GoTestParser, SourceRange } from './parser';
import { normalizeTableTestConfig, type TableTestConfig } from './tableTestConfig';

/** CodeLens provider 的依赖项，测试和后续缓存实现可以替换 parser/config。 */
export type GoTestCodeLensProviderOptions = {
  /** Go 测试文件 parser；默认使用 Go helper parser。 */
  parser?: GoTestParser;
  /** 读取当前配置的函数，默认从 VSCode workspace configuration 读取。 */
  getConfig?: () => TableTestConfig;
  /** 解析错误的记录目标，默认静默。 */
  output?: Pick<vscode.OutputChannel, 'appendLine'>;
};

/** 为 Go `_test.go` 文件提供 `Run Test` 和 `Run Case` CodeLens。 */
export class GoTestCodeLensProvider implements vscode.CodeLensProvider {
  private readonly parser: GoTestParser;
  private readonly getConfig: () => TableTestConfig;
  private readonly output?: Pick<vscode.OutputChannel, 'appendLine'>;

  /** 创建 provider；默认依赖适合真实扩展运行，options 主要服务自动化测试和后续缓存演进。 */
  public constructor(options: GoTestCodeLensProviderOptions = {}) {
    this.parser = options.parser ?? new GoHelperParser();
    this.getConfig = options.getConfig ?? readTableTestConfigFromWorkspace;
    this.output = options.output;
  }

  /**
   * 生成当前文档的运行 CodeLens。
   *
   * VSCode 会在打开、保存或编辑文档时调用该方法。这里每次读取 document 文本而不是磁盘文件，
   * 是为了支持未保存 buffer；helper parser 能在语法未完成时返回部分结果或诊断。
   */
  public async provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<vscode.CodeLens[]> {
    void token;
    const config = this.getConfig();
    const file = document.uri.fsPath;
    if (!config.enabled || !isGoTestFile(file)) {
      return [];
    }

    try {
      const parser =
        this.parser instanceof GoHelperParser ? new GoHelperParser({ nameFields: config.nameFields }) : this.parser;
      const result = await parser.parseTestFile(file, document.getText());
      return createGoTestCodeLensTargets(result, config).map(target => {
        return new vscode.CodeLens(toVsCodeRange(target.range), {
          title: target.title,
          command: commands.runTest,
          arguments: [target.runTarget]
        });
      });
    } catch (error) {
      this.output?.appendLine(`Go Plus CodeLens parse failed for ${file}: ${String(error)}`);
      return [];
    }
  }
}

/** 从 VSCode 配置读取并归一化 table-driven test 选项。 */
export function readTableTestConfigFromWorkspace(): TableTestConfig {
  const configuration = vscode.workspace.getConfiguration();
  return normalizeTableTestConfig({
    enabled: configuration.get(configurationKeys.enabled),
    nameFields: configuration.get(configurationKeys.nameFields),
    showFunctionRun: configuration.get(configurationKeys.showFunctionRun),
    showCaseRun: configuration.get(configurationKeys.showCaseRun)
  });
}

function toVsCodeRange(range: SourceRange): vscode.Range {
  return new vscode.Range(
    new vscode.Position(range.start.line, range.start.character),
    new vscode.Position(range.end.line, range.end.character)
  );
}
