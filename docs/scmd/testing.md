# Testing

CLI testing is where scmd's "no global state" rule pays off. An app is a value; build a fresh one per test and run them all in parallel.

## scmdtest

```go
import "github.com/dvislobokov/scmd/scmdtest"

func TestDeployValidation(t *testing.T) {
	t.Parallel()
	res := scmdtest.Run(newApp(), "deploy", "--env", "prod", "api", "web")
	if res.ExitCode != 2 {
		t.Fatalf("expected usage error, got %d; stderr: %s", res.ExitCode, res.Stderr)
	}
	if !strings.Contains(res.Stderr, "one service at a time") {
		t.Fatalf("stderr: %s", res.Stderr)
	}
}
```

`Run(app, args...)` (and `RunContext`) executes the app with captured streams and returns:

```go
type Result struct {
	ExitCode int    // 0 success, 1 handler error, 2 usage error
	Stdout   string
	Stderr   string
}
```

No `os.Stdout` swapping, no flag-state reset between tests, no `cmd.SetArgs` — the things that make cobra tests order-dependent simply do not exist here.

## Capturing bound options

To assert on the binding itself, close over a variable in the handler:

```go
var got ServeOptions
app := scmd.New("app", "",
	scmd.Cmd("serve", "", func(ctx context.Context, o ServeOptions) error {
		got = o
		return nil
	}))
scmdtest.Run(app, "serve", "-p", "9090", "conf.json")
// assert on got.Port, got.Config, ...
```

## The contract smoke test

Because every tag, default, enum, and flag-group constraint is validated when the app is constructed, this one-liner proves the entire CLI contract and fails with the exact `Type.Field` on any mistake:

```go
func TestCLIContract(t *testing.T) { newApp() }
```

## Environment layers in tests

Use `t.Setenv` — it is incompatible with `t.Parallel()` by design, which is exactly right for env-dependent cases:

```go
func TestEnvLayer(t *testing.T) {
	t.Setenv("APP_TIMEOUT", "45s")
	res := scmdtest.Run(newApp(), "serve", "conf.json")
	// ...
}
```

For the sconf layer, build the app with an in-memory configuration — see [Configuration layers](./configuration.md).
