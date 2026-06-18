package parserfixture

import "testing"

// TestAlpha 覆盖最常见的 Go 测试函数签名，应被 parser 识别并返回函数 range。
func TestAlpha(t *testing.T) {
	t.Helper()
}

// helperNotATest 虽然参数兼容，但函数名不以 Test 开头，应被安全跳过。
func helperNotATest(t *testing.T) {
	t.Helper()
}

// TestWrongParam 覆盖参数不兼容的边界，避免把 benchmark 风格参数误判成普通测试。
func TestWrongParam(t *testing.B) {
	t.Helper()
}

// BenchmarkAlpha 当前阶段不是目标范围，应由测试保护为不识别。
func BenchmarkAlpha(b *testing.B) {
	b.ReportAllocs()
}

// TestSecond 验证同一文件内可以返回多个测试函数，且位置保持源码顺序。
func TestSecond(t *testing.T) {
	t.Helper()
}
