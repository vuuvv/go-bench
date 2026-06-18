# Go Bench

Go Bench is a VSCode extension that improves Go table-driven test workflows.
It adds editor run entries for whole Go test functions and resolvable table
test cases, so you can run a single case without rewriting code or manually
assembling `go test -run` patterns.

## Features

- Shows `Run Test` CodeLens entries for Go `TestXxx` functions.
- Shows `Run Case` CodeLens entries for table-driven cases with stable names.
- Builds standard `go test <package> -run <pattern>` commands and preserves the
  original `go test` output in the Go Bench output channel.
- Escapes regular expression characters in test and subtest names before running
  a targeted test.
- Supports configurable table case name fields, including `name`, `desc`,
  `caseName`, and `title` by default.
- Provides an experimental VSCode Testing API tree for discovered table tests.
- Adds a `Refresh Test Tree` CodeLens at the top of Go test files to refresh the
  current file in Test Explorer when the experimental tree is enabled.

Go Bench is designed to complement the official Go extension, not replace it.

## Requirements

- VSCode 1.90.0 or newer.
- The Go toolchain available on `PATH`.
- Go test files ending in `_test.go`.

## Supported Test Pattern

Go Bench focuses on common local table-driven tests:

```go
func TestNormalize(t *testing.T) {
	tests := []struct {
		name string
		input string
		want string
	}{
		{name: "empty", input: "", want: ""},
		{name: "simple", input: "a", want: "a"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// assertions
		})
	}
}
```

When a case name can be resolved safely, Go Bench shows a case-level run entry.
Dynamic names, helper-generated tables, and runtime-only data are intentionally
ignored instead of producing unreliable run buttons.

## Commands

- `Go Bench: Run Test`
- `Go Bench: Refresh Test Tree`
- `Go Bench: Refresh Current File Test Tree`
- `Go Bench: No-op`

## Configuration

```json
{
  "goBench.tableTests.enabled": true,
  "goBench.tableTests.nameFields": ["name", "desc", "caseName", "title"],
  "goBench.tableTests.showFunctionRun": true,
  "goBench.tableTests.showCaseRun": true,
  "goBench.tableTests.testingApi.enabled": false
}
```

## Development

```sh
npm install
npm run compile
npm run lint
npm test
```

Use the `Run Go Bench Extension` launch configuration to start an Extension Development Host.

## Repository

https://github.com/vuuvv/go-bench

## License

MIT
