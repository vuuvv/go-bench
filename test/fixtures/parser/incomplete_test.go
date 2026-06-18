package parserfixture

import "testing"

// TestCompleteBeforeError 验证语法错误前的完整函数仍可从 Go parser 的部分 AST 中取回。
func TestCompleteBeforeError(t *testing.T) {
	t.Helper()
}

// TestBroken 故意缺少函数体结尾，覆盖用户正在编辑文件时 parser 返回诊断但不抛异常的行为。
func TestBroken(t *testing.T) {
	if true {
