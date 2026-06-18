# Go Bench

English | [中文](README_zh.md)

Go Bench is a VSCode extension that improves Go table-driven test workflows.
It focuses on the common pain point of running a single table case without
editing source code or manually assembling `go test -run` patterns. It does not
replace the official Go extension; instead, it reuses the standard Go toolchain
and VSCode Testing API to provide more precise run, debug, and result views from
CodeLens and Test Explorer.

## Core Features

- Shows `Run Test` and `Debug Test` CodeLens entries on Go `TestXxx` functions.
- Shows `Run Case` and `Debug Case` CodeLens entries for statically resolvable table-driven cases.
- Builds standard `go test <package> -run <pattern>` commands and escapes test names, whitespace, slashes, and regular expression metacharacters according to Go subtest rules.
- Enables VSCode Test Explorer integration by default. The test controller is named `Go Bench`.
- Uses the Go Bench enhanced tree by default: `module path -> relative package directory -> *_test.go -> TestXxx -> table case`.
- Writes run results to VSCode Test Results while keeping command text, raw output, and diagnostics in the `Go Bench` output channel.
- Supports running or debugging function nodes, case nodes, and structural nodes such as package, file, and module nodes from Test Explorer.

## Requirements

- VSCode 1.90.0 or newer.
- The Go toolchain available on `PATH`.
- The official Go extension is recommended. Debug actions depend on the official Go debug adapter and Delve.
- Test files must end with `_test.go`.
- To appear in the Go Bench Test Explorer tree, a test file must belong to a valid Go module, meaning one of its parent directories contains a `go.mod` file with a `module ...` declaration.

## Supported Test Patterns

Go Bench currently focuses on common local table-driven tests:

```go
func TestNormalize(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
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

Supported:

- Regular Go test functions whose names start with `Test` and whose first parameter is compatible with `*testing.T`.
- Local table variables declared inside a test function.
- Struct composite literal tables.
- Stable string fields such as `name`, `desc`, `caseName`, and `title`.
- `for range` loops over a table variable.
- `t.Run(tt.name, func(t *testing.T) { ... })` subtests.
- Positional struct values when field order can be resolved safely.
- Map-based tables that use string map keys as subtest names.

Intentionally unsupported:

- Runtime-generated case names, such as `fmt.Sprintf`, string concatenation, or helper function return values.
- Tables loaded from files, network data, or other runtime-only sources.
- Ambiguous combinations of multiple table variables and range variables.
- First-class benchmark or fuzz test support.

Cases that cannot be resolved safely are ignored instead of producing unreliable case-level run entries.

## Test Explorer Tree

When `goBench.tableTests.testingApi.enabled` is enabled, which is the default,
Test Explorer shows a `Go Bench` test controller. The default tree mode is
`goBench`:

```text
Go Bench
└── example.com/project
    └── internal/normalize
        └── normalize_test.go
            └── TestNormalize
                ├── empty
                └── simple
```

Tree semantics:

- `Go Bench` is the extension test controller name.
- The first level is a valid Go module. It displays the module path from `go.mod`, not the directory name.
- Under a module, package/directory labels are relative to the module root and do not include a `./` prefix. The module root itself is shown as `.`.
- Under each package/directory is the `_test.go` file.
- Under each file are the `TestXxx` functions.
- In `goBench` tree mode, resolvable table cases are shown below the function node.

If you switch to `standardGo` tree mode, the tree still uses module, directory,
file, and test function levels, but it does not expand Go Bench-specific table
case nodes. This is closer to the official Go extension's function-level test
tree.

## Commands

### `Go Bench: Run Test`

Runs a Go Bench test target. This command is normally invoked by CodeLens or
Test Explorer and is not intended to be run manually from the command palette,
because it requires a concrete test target argument.

Behavior:

- A function target runs the whole `TestXxx`.
- A case target runs the corresponding `TestXxx/subtest`.
- Uses `go test -json` and creates a Testing API `TestRun`.
- Writes output and failure details to VSCode Test Results.
- Records the actual command and diagnostics in the `Go Bench` output channel.

### `Go Bench: Debug Test`

Debugs a Go Bench test target. This command is normally invoked by CodeLens or
Test Explorer.

Behavior:

- Uses the VSCode debug API to start the official Go debug adapter.
- Builds a debug configuration with `type: "go"`, `request: "launch"`, and `mode: "test"`.
- Passes the test filter as `["-test.run", pattern]`.
- A function target debugs only the target `TestXxx`.
- A case target debugs only the matching table case.
- If VSCode accepts the debug request but no debug session is observed, Go Bench shows a warning.

### `Go Bench: Refresh Test Tree`

Scans Go `_test.go` files in the current workspace and rebuilds the `Go Bench`
Test Explorer tree.

Use this when:

- Test files are added, deleted, or moved.
- A `go.mod` module path changes.
- Settings are changed and you want to rebuild the tree immediately.
- Test Explorer nodes look stale.

If `goBench.tableTests.testingApi.enabled` is disabled, the command asks you to
enable Test Explorer integration first.

### `Go Bench: Refresh Current File Test Tree`

Refreshes only the current Go `_test.go` file in Test Explorer.

Entry points:

- Command palette.
- The `Refresh Test Tree` CodeLens at the top of a Go test file.

Behavior:

- The current file must be a `_test.go` file.
- The current file must belong to a valid Go module.
- Only the current file's file/function/case subtree is replaced.
- Nodes for other files are not cleared.

### `Go Bench: Toggle Test Tree Mode`

Switches between the two Test Explorer tree modes:

- `goBench`: the default mode. Shows table-driven case nodes.
- `standardGo`: function-level mode. Does not show table case nodes.

The command writes the workspace setting
`goBench.tableTests.testingApi.treeMode`. If Testing API integration is enabled,
the test tree refreshes immediately.

This command is also contributed to the Testing view title area. If the button
is not visible in your VSCode version or layout, run it from the command
palette.

### `Go Bench: No-op`

Verifies that the extension is active. It writes a log line to the `Go Bench`
output channel and shows an information message.

## Settings

Default settings:

```json
{
  "goBench.tableTests.enabled": true,
  "goBench.tableTests.nameFields": ["name", "desc", "caseName", "title"],
  "goBench.tableTests.showFunctionRun": true,
  "goBench.tableTests.showCaseRun": true,
  "goBench.tableTests.testingApi.enabled": true,
  "goBench.tableTests.testingApi.treeMode": "goBench"
}
```

### `goBench.tableTests.enabled`

Enables Go table-driven test discovery.

- `true`: enables parsing, CodeLens target generation, and Test Explorer target generation.
- `false`: hides Go Bench test run entries. Refreshing the Testing API tree clears Go Bench nodes.

### `goBench.tableTests.nameFields`

Field names that can provide table case names.

Default:

```json
["name", "desc", "caseName", "title"]
```

Example:

```json
{
  "goBench.tableTests.nameFields": ["name", "scenario", "title"]
}
```

When a table entry contains one of these fields and the value is a static
string, Go Bench treats it as the subtest/case name.

### `goBench.tableTests.showFunctionRun`

Controls function-level run and debug entries.

- `true`: shows `Run Test` / `Debug Test` on `TestXxx`, and creates function nodes in Test Explorer.
- `false`: hides function-level entries. The current implementation also skips that function and its case nodes.

### `goBench.tableTests.showCaseRun`

Controls case-level run and debug entries.

- `true`: shows `Run Case` / `Debug Case` for statically resolvable table cases, and shows case nodes in `goBench` tree mode.
- `false`: keeps only function-level entries and hides table case entries.

Note: `standardGo` tree mode does not expand table cases in Test Explorer even
when this setting is `true`. CodeLens case visibility is still controlled by
this setting.

### `goBench.tableTests.testingApi.enabled`

Enables VSCode Testing API / Test Explorer integration.

Default: `true`.

- `true`: creates the `Go Bench` Test Explorer tree and writes run results to Test Results.
- `false`: disposes the Go Bench Test Explorer controller. CodeLens entries remain available.

### `goBench.tableTests.testingApi.treeMode`

Controls the Test Explorer tree mode.

Allowed values:

- `goBench`: the default. Shows the Go Bench enhanced tree, including resolvable table cases.
- `standardGo`: shows a tree closer to the official Go extension's function-level tree and does not expand table cases.

Example:

```json
{
  "goBench.tableTests.testingApi.treeMode": "standardGo"
}
```

You can also switch modes with `Go Bench: Toggle Test Tree Mode`.

## Output And Results

- Test Results: the primary result surface. CodeLens and Test Explorer runs both create Testing API `TestRun` objects.
- Test Explorer: shows running, passed, failed, skipped, and error states.
- `Go Bench` output channel: auxiliary diagnostics, including actual commands, parser diagnostics, go.mod resolution issues, debug configurations, and raw output.

If `go test` output cannot be mapped to a specific subtest, Go Bench writes it
to the global output for the current test run so the result is not lost.

## Development

Install dependencies:

```sh
npm install
```

Compile:

```sh
npm run compile
```

Run tests:

```sh
npm test
```

Run lint:

```sh
npm run lint
```

Use the `Run Go Bench Extension` launch configuration in VSCode to start an
Extension Development Host.

## Manual Verification

1. Open a Go workspace that contains a `go.mod` file.
2. Open a `_test.go` file and confirm that CodeLens entries appear on functions and table cases.
3. Open Test Explorer and confirm that the `Go Bench` tree appears.
4. Confirm that the tree structure is `module path -> relative directory -> file -> TestXxx -> case`.
5. Click `Run Test` and `Run Case`, then inspect output in Test Results.
6. Run `Go Bench: Toggle Test Tree Mode` and confirm that case nodes can be hidden and restored.
7. Click `Debug Test` or `Debug Case` and confirm that VSCode starts a Go test debug session.

## Repository

https://github.com/vuuvv/go-bench

## License

MIT
