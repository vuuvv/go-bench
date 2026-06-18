/**
 * Go parser helper 的源码。
 *
 * helper 使用 Go 官方 `go/parser` 和 `go/ast` 解析源码，避免第一阶段依赖质量不确定的
 * TypeScript Go parser。源码以内嵌字符串形式随 extension 编译，运行时写入临时目录后通过
 * `go run` 执行；这能验证方案，同时避开 `.go` 文件在 VSCode extension 打包中被遗漏的问题。
 */

/** 由 TypeScript wrapper 写入临时目录并执行的 Go helper 源码。 */
export const goParserHelperSource = String.raw`package main

import (
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/scanner"
	"go/token"
	"os"
	"sort"
	"strings"
	"unicode/utf8"
)

type parseRequest struct {
	FileName string ${'`'}json:"fileName"${'`'}
	Source   string ${'`'}json:"source"${'`'}
}

type sourcePosition struct {
	Line      int ${'`'}json:"line"${'`'}
	Character int ${'`'}json:"character"${'`'}
}

type sourceRange struct {
	Start sourcePosition ${'`'}json:"start"${'`'}
	End   sourcePosition ${'`'}json:"end"${'`'}
}

type parserDiagnostic struct {
	Message   string ${'`'}json:"message"${'`'}
	Line      *int   ${'`'}json:"line,omitempty"${'`'}
	Character *int   ${'`'}json:"character,omitempty"${'`'}
	Severity  string ${'`'}json:"severity"${'`'}
}

type testFunction struct {
	Name      string      ${'`'}json:"name"${'`'}
	File      string      ${'`'}json:"file"${'`'}
	Range     sourceRange ${'`'}json:"range"${'`'}
	NameRange sourceRange ${'`'}json:"nameRange"${'`'}
}

type parseResponse struct {
	File          string             ${'`'}json:"file"${'`'}
	PackageName   string             ${'`'}json:"packageName"${'`'}
	TestFunctions []testFunction     ${'`'}json:"testFunctions"${'`'}
	Diagnostics   []parserDiagnostic ${'`'}json:"diagnostics"${'`'}
}

func main() {
	var req parseRequest
	if err := json.NewDecoder(os.Stdin).Decode(&req); err != nil {
		writeError(fmt.Sprintf("invalid parser request: %v", err))
		return
	}

	response := parse(req)
	if err := json.NewEncoder(os.Stdout).Encode(response); err != nil {
		fmt.Fprintf(os.Stderr, "failed to encode parser response: %v\n", err)
		os.Exit(1)
	}
}

func writeError(message string) {
	response := parseResponse{
		Diagnostics: []parserDiagnostic{{Message: message, Severity: "error"}},
	}
	_ = json.NewEncoder(os.Stdout).Encode(response)
}

func parse(req parseRequest) parseResponse {
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, req.FileName, req.Source, parser.ParseComments)

	response := parseResponse{
		File:          req.FileName,
		TestFunctions: []testFunction{},
		Diagnostics:   diagnosticsFromError(fset, err, req.Source),
	}

	// Go parser 在语法未完成时可能仍返回部分 AST。这里保留可用结果，保护用户正在编辑文件时
	// CodeLens 刷新不会因为一个半截函数而全部失效。
	if file == nil {
		return response
	}

	response.PackageName = file.Name.Name
	lineStarts := buildLineStarts(req.Source)

	for _, decl := range file.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if !ok {
			continue
		}

		// 第一阶段只识别普通顶层测试函数。带 receiver 的方法、benchmark、fuzz 和参数不兼容的
		// 函数都跳过，避免后续 UI 展示无法运行或语义不明确的入口。
		if !isTestFunction(fn) {
			continue
		}

		response.TestFunctions = append(response.TestFunctions, testFunction{
			Name: fn.Name.Name,
			File: req.FileName,
			Range: sourceRange{
				Start: positionFor(fset, lineStarts, req.Source, fn.Pos()),
				End:   positionFor(fset, lineStarts, req.Source, fn.End()),
			},
			NameRange: sourceRange{
				Start: positionFor(fset, lineStarts, req.Source, fn.Name.Pos()),
				End:   positionFor(fset, lineStarts, req.Source, fn.Name.End()),
			},
		})
	}

	return response
}

func diagnosticsFromError(fset *token.FileSet, err error, source string) []parserDiagnostic {
	if err == nil {
		return []parserDiagnostic{}
	}

	lineStarts := buildLineStarts(source)
	var diagnostics []parserDiagnostic

	// scanner.ErrorList 能保留多条语法错误；普通 error 则退化为不带位置的诊断。
	if list, ok := err.(scanner.ErrorList); ok {
		for _, scanErr := range list {
			position := positionFromOffset(lineStarts, source, scanErr.Pos.Offset)
			line := position.Line
			character := position.Character
			diagnostics = append(diagnostics, parserDiagnostic{
				Message:   scanErr.Msg,
				Line:      &line,
				Character: &character,
				Severity:  "error",
			})
		}
		return diagnostics
	}

	position := fset.Position(token.NoPos)
	diagnostics = append(diagnostics, parserDiagnostic{
		Message:  err.Error(),
		Severity: "error",
	})
	if position.IsValid() {
		line := position.Line - 1
		character := max(position.Column-1, 0)
		diagnostics[0].Line = &line
		diagnostics[0].Character = &character
	}
	return diagnostics
}

func isTestFunction(fn *ast.FuncDecl) bool {
	if fn.Recv != nil || !strings.HasPrefix(fn.Name.Name, "Test") {
		return false
	}

	if fn.Type == nil || fn.Type.Params == nil || len(fn.Type.Params.List) == 0 {
		return false
	}

	return isTestingTStar(fn.Type.Params.List[0].Type)
}

func isTestingTStar(expr ast.Expr) bool {
	star, ok := expr.(*ast.StarExpr)
	if !ok {
		return false
	}

	selector, ok := star.X.(*ast.SelectorExpr)
	if !ok {
		return false
	}

	pkg, ok := selector.X.(*ast.Ident)
	return ok && pkg.Name == "testing" && selector.Sel.Name == "T"
}

func buildLineStarts(source string) []int {
	starts := []int{0}
	for offset, b := range []byte(source) {
		if b == '\n' {
			starts = append(starts, offset+1)
		}
	}
	return starts
}

func positionFor(fset *token.FileSet, lineStarts []int, source string, pos token.Pos) sourcePosition {
	if !pos.IsValid() {
		return sourcePosition{}
	}
	position := fset.PositionFor(pos, false)
	return positionFromOffset(lineStarts, source, position.Offset)
}

func positionFromOffset(lineStarts []int, source string, offset int) sourcePosition {
	offset = min(max(offset, 0), len([]byte(source)))
	line := sort.Search(len(lineStarts), func(i int) bool {
		return lineStarts[i] > offset
	}) - 1
	if line < 0 {
		line = 0
	}

	lineStart := lineStarts[line]
	return sourcePosition{
		Line:      line,
		Character: utf16UnitsBetween(source, lineStart, offset),
	}
}

func utf16UnitsBetween(source string, start int, end int) int {
	bytes := []byte(source)
	count := 0
	for start < end {
		r, size := utf8.DecodeRune(bytes[start:end])
		if r == utf8.RuneError && size == 1 {
			count++
			start++
			continue
		}
		if r > 0xFFFF {
			count += 2
		} else {
			count++
		}
		start += size
	}
	return count
}
`;
