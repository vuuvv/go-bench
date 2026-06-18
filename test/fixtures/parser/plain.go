package parserfixture

import "testing"

// TestPlainFile 看起来像测试函数，但文件名不是 `_test.go`，wrapper 应在 TypeScript 层跳过。
func TestPlainFile(t *testing.T) {
	t.Helper()
}
