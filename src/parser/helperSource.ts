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
	"strconv"
	"strings"
	"unicode/utf8"
)

type parseRequest struct {
	FileName   string   ${'`'}json:"fileName"${'`'}
	Source     string   ${'`'}json:"source"${'`'}
	NameFields []string ${'`'}json:"nameFields"${'`'}
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
	Name       string          ${'`'}json:"name"${'`'}
	File       string          ${'`'}json:"file"${'`'}
	Range      sourceRange     ${'`'}json:"range"${'`'}
	NameRange  sourceRange     ${'`'}json:"nameRange"${'`'}
	TableCases []tableTestCase ${'`'}json:"tableCases"${'`'}
}

type tableTestCase struct {
	ID          string      ${'`'}json:"id"${'`'}
	Label       string      ${'`'}json:"label"${'`'}
	File        string      ${'`'}json:"file"${'`'}
	TestName    string      ${'`'}json:"testName"${'`'}
	SubtestName string      ${'`'}json:"subtestName"${'`'}
	SubtestPath []string    ${'`'}json:"subtestPath"${'`'}
	Range       sourceRange ${'`'}json:"range"${'`'}
	Confidence  string      ${'`'}json:"confidence"${'`'}
}

type tableInfo struct {
	Entries []tableEntry
}

type tableEntry struct {
	Names map[string]string
	Range sourceRange
}

type rangeBinding struct {
	Table      tableInfo
	KeyIdent   string
	ValueIdent string
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
	nameFields := normalizeNameFields(req.NameFields)

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
				TableCases: detectTableCases(fset, lineStarts, req.Source, req.FileName, fn, nameFields),
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

func normalizeNameFields(fields []string) map[string]bool {
	if len(fields) == 0 {
		fields = []string{"name", "desc", "caseName", "title"}
	}

	result := map[string]bool{}
	for _, field := range fields {
		field = strings.TrimSpace(field)
		if field != "" {
			result[field] = true
		}
	}
	return result
}

func detectTableCases(fset *token.FileSet, lineStarts []int, source string, fileName string, fn *ast.FuncDecl, nameFields map[string]bool) []tableTestCase {
	if fn.Body == nil {
		return []tableTestCase{}
	}

	testingTName := testingTIdentifier(fn)
	if testingTName == "" {
		return []tableTestCase{}
	}

	tables := map[string]tableInfo{}
	cases := []tableTestCase{}
	seen := map[string]bool{}

	for _, stmt := range fn.Body.List {
		// table 变量只在函数体顶层收集，避免跨 block 的作用域遮蔽造成误判。后续如需支持更复杂作用域，
		// 应先建立明确的 scope model，而不是让同名变量在不同 block 间互相覆盖。
		collectLocalTables(fset, lineStarts, source, stmt, nameFields, tables)

		rangeStmt, ok := stmt.(*ast.RangeStmt)
		if !ok {
			continue
		}

		binding, ok := rangeBindingFor(fset, lineStarts, source, rangeStmt, nameFields, tables)
		if !ok {
			continue
		}

		// 只在已经确认 range 来源是可解析 table 时扫描 t.Run。动态 table 或无法确定 range 变量的循环
		// 会被跳过，保护后续 CodeLens 不生成可能运行错误 case 的入口。
		for _, candidate := range casesFromRange(fset, lineStarts, source, fileName, fn.Name.Name, testingTName, rangeStmt, binding) {
			key := fmt.Sprintf("%s\x00%d\x00%d", candidate.SubtestName, candidate.Range.Start.Line, candidate.Range.Start.Character)
			if seen[key] {
				continue
			}
			seen[key] = true
			cases = append(cases, candidate)
		}
	}

	return cases
}

func collectLocalTables(fset *token.FileSet, lineStarts []int, source string, stmt ast.Stmt, nameFields map[string]bool, tables map[string]tableInfo) {
	switch stmt := stmt.(type) {
	case *ast.AssignStmt:
		for i, rhs := range stmt.Rhs {
			if i >= len(stmt.Lhs) {
				continue
			}
			name := identName(stmt.Lhs[i])
			if name == "" {
				continue
			}
			if table, ok := tableInfoFromExpr(fset, lineStarts, source, rhs, nameFields); ok {
				tables[name] = table
			}
		}
	case *ast.DeclStmt:
		decl, ok := stmt.Decl.(*ast.GenDecl)
		if !ok {
			return
		}
		for _, spec := range decl.Specs {
			valueSpec, ok := spec.(*ast.ValueSpec)
			if !ok {
				continue
			}
			for i, value := range valueSpec.Values {
				if i >= len(valueSpec.Names) {
					continue
				}
				if table, ok := tableInfoFromExpr(fset, lineStarts, source, value, nameFields); ok {
					tables[valueSpec.Names[i].Name] = table
				}
			}
		}
	}
}

func rangeBindingFor(fset *token.FileSet, lineStarts []int, source string, rangeStmt *ast.RangeStmt, nameFields map[string]bool, tables map[string]tableInfo) (rangeBinding, bool) {
	var table tableInfo
	var ok bool

	switch expr := rangeStmt.X.(type) {
	case *ast.Ident:
		table, ok = tables[expr.Name]
	case *ast.CompositeLit:
		// inline table literal 没有变量名，但语义与本地 table 相同；只要元素名称可静态解析，就可以
		// 直接参与 range 变量映射。
		table, ok = tableInfoFromLiteral(fset, lineStarts, source, expr, nameFields)
	default:
		ok = false
	}
	if !ok || len(table.Entries) == 0 {
		return rangeBinding{}, false
	}

	binding := rangeBinding{
		Table:      table,
		KeyIdent:   identName(rangeStmt.Key),
		ValueIdent: identName(rangeStmt.Value),
	}
	if binding.KeyIdent == "_" {
		binding.KeyIdent = ""
	}
	if binding.ValueIdent == "_" {
		binding.ValueIdent = ""
	}
	if binding.KeyIdent == "" && binding.ValueIdent == "" {
		return rangeBinding{}, false
	}

	return binding, true
}

func tableInfoFromExpr(fset *token.FileSet, lineStarts []int, source string, expr ast.Expr, nameFields map[string]bool) (tableInfo, bool) {
	literal, ok := expr.(*ast.CompositeLit)
	if !ok {
		return tableInfo{}, false
	}
	return tableInfoFromLiteral(fset, lineStarts, source, literal, nameFields)
}

func tableInfoFromLiteral(fset *token.FileSet, lineStarts []int, source string, literal *ast.CompositeLit, nameFields map[string]bool) (tableInfo, bool) {
	switch typ := literal.Type.(type) {
	case *ast.ArrayType:
		return tableInfoFromSliceLiteral(fset, lineStarts, source, literal, typ, nameFields)
	case *ast.MapType:
		return tableInfoFromMapLiteral(fset, lineStarts, source, literal)
	default:
		return tableInfo{}, false
	}
}

func tableInfoFromSliceLiteral(fset *token.FileSet, lineStarts []int, source string, literal *ast.CompositeLit, typ *ast.ArrayType, nameFields map[string]bool) (tableInfo, bool) {
	structType, ok := typ.Elt.(*ast.StructType)
	if !ok {
		return tableInfo{}, false
	}

	fieldNames := structFieldNames(structType)
	if len(fieldNames) == 0 {
		return tableInfo{}, false
	}

	var entries []tableEntry
	for _, element := range literal.Elts {
		entryLiteral, ok := element.(*ast.CompositeLit)
		if !ok {
			continue
		}

		entry := tableEntry{
			Names: map[string]string{},
			Range: rangeForNode(fset, lineStarts, source, entryLiteral),
		}

		for i, value := range entryLiteral.Elts {
			if keyValue, ok := value.(*ast.KeyValueExpr); ok {
				field := identName(keyValue.Key)
				if nameFields[field] {
					if text, ok := stringLiteralValue(keyValue.Value); ok {
						entry.Names[field] = text
					}
				}
				continue
			}

			if i >= len(fieldNames) {
				continue
			}
			field := fieldNames[i]
			if nameFields[field] {
				if text, ok := stringLiteralValue(value); ok {
					entry.Names[field] = text
				}
			}
		}

		// 没有静态名称的 entry 保留为“不支持”而不是产出 probable 结果；这能避免 fmt.Sprintf、
		// helper 返回值或变量引用被错误解释为可运行 case。
		if len(entry.Names) > 0 {
			entries = append(entries, entry)
		}
	}

	return tableInfo{Entries: entries}, len(entries) > 0
}

func tableInfoFromMapLiteral(fset *token.FileSet, lineStarts []int, source string, literal *ast.CompositeLit) (tableInfo, bool) {
	if mapType, ok := literal.Type.(*ast.MapType); !ok || !isStringType(mapType.Key) {
		return tableInfo{}, false
	}

	var entries []tableEntry
	for _, element := range literal.Elts {
		keyValue, ok := element.(*ast.KeyValueExpr)
		if !ok {
			continue
		}
		name, ok := stringLiteralValue(keyValue.Key)
		if !ok {
			continue
		}
		entries = append(entries, tableEntry{
			Names: map[string]string{"$mapKey": name},
			Range: rangeForNode(fset, lineStarts, source, keyValue),
		})
	}

	return tableInfo{Entries: entries}, len(entries) > 0
}

func casesFromRange(fset *token.FileSet, lineStarts []int, source string, fileName string, testName string, testingTName string, rangeStmt *ast.RangeStmt, binding rangeBinding) []tableTestCase {
	cases := []tableTestCase{}
	ast.Inspect(rangeStmt.Body, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok || !isTestingTRunCall(call, testingTName) || len(call.Args) == 0 {
			return true
		}

		nameKey, ok := runNameKey(call.Args[0], binding)
		if !ok {
			return true
		}

		for _, entry := range binding.Table.Entries {
			name, ok := entry.Names[nameKey]
			if !ok {
				continue
			}
			cases = append(cases, newTableTestCase(fileName, testName, name, entry.Range))
		}

		return true
	})
	return cases
}

func runNameKey(expr ast.Expr, binding rangeBinding) (string, bool) {
	switch expr := expr.(type) {
	case *ast.SelectorExpr:
		owner, ok := expr.X.(*ast.Ident)
		if ok && owner.Name == binding.ValueIdent {
			return expr.Sel.Name, true
		}
	case *ast.Ident:
		if expr.Name == binding.KeyIdent {
			return "$mapKey", true
		}
	}

	return "", false
}

func newTableTestCase(fileName string, testName string, subtestName string, sourceRange sourceRange) tableTestCase {
	return tableTestCase{
		ID:          fmt.Sprintf("%s:%d:%d:%s/%s", fileName, sourceRange.Start.Line, sourceRange.Start.Character, testName, subtestName),
		Label:       fmt.Sprintf("%s/%s", testName, subtestName),
		File:        fileName,
		TestName:    testName,
		SubtestName: subtestName,
		SubtestPath: []string{subtestName},
		Range:       sourceRange,
		Confidence:  "exact",
	}
}

func testingTIdentifier(fn *ast.FuncDecl) string {
	if fn.Type == nil || fn.Type.Params == nil || len(fn.Type.Params.List) == 0 {
		return ""
	}
	firstParam := fn.Type.Params.List[0]
	if len(firstParam.Names) == 0 {
		return ""
	}
	return firstParam.Names[0].Name
}

func isTestingTRunCall(call *ast.CallExpr, testingTName string) bool {
	selector, ok := call.Fun.(*ast.SelectorExpr)
	if !ok || selector.Sel.Name != "Run" {
		return false
	}
	receiver, ok := selector.X.(*ast.Ident)
	return ok && receiver.Name == testingTName
}

func structFieldNames(structType *ast.StructType) []string {
	var fields []string
	for _, field := range structType.Fields.List {
		for _, name := range field.Names {
			fields = append(fields, name.Name)
		}
	}
	return fields
}

func identName(expr ast.Expr) string {
	ident, ok := expr.(*ast.Ident)
	if !ok {
		return ""
	}
	return ident.Name
}

func stringLiteralValue(expr ast.Expr) (string, bool) {
	literal, ok := expr.(*ast.BasicLit)
	if !ok || literal.Kind != token.STRING {
		return "", false
	}
	value, err := strconv.Unquote(literal.Value)
	if err != nil {
		return "", false
	}
	return value, true
}

func isStringType(expr ast.Expr) bool {
	ident, ok := expr.(*ast.Ident)
	return ok && ident.Name == "string"
}

func rangeForNode(fset *token.FileSet, lineStarts []int, source string, node ast.Node) sourceRange {
	return sourceRange{
		Start: positionFor(fset, lineStarts, source, node.Pos()),
		End:   positionFor(fset, lineStarts, source, node.End()),
	}
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
