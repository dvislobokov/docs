# Quick Start

This walkthrough builds `depl` — a small deploy tool with two commands, a command group, configuration layering and a test.

## 1. Declare options as structs

Each command (a *verb*, in CommandLineParser terms) gets its own options struct. Shared flags are an embedded struct — explicit, no "persistent flags" inheritance to reason about:

```go
type Globals struct {
	Verbose scmd.Count `flag:"verbose" short:"v" help:"-v, -vv, -vvv"`
	Output  string     `flag:"output" short:"o" default:"text" enum:"text,json,yaml" help:"Output format"`
}

type ServeOptions struct {
	Globals
	Port    int           `flag:"port" short:"p" default:"8080" conf:"server.port" help:"HTTP port"`
	Timeout time.Duration `flag:"timeout" default:"30s" env:"DEPL_TIMEOUT" help:"Request timeout"`
	Config  string        `arg:"config" required:"true" help:"Path to the app config"`
}

type DeployOptions struct {
	Globals
	Env      string            `flag:"env" required:"true" enum:"dev,stage,prod" help:"Target environment"`
	Labels   map[string]string `flag:"label" short:"l" help:"Release labels: -l team=core,tier=1"`
	DryRun   scmd.Value[bool]  `flag:"dry-run" help:"Print the plan only"`
	Services []string          `arg:"..." name:"services" help:"Services to deploy"`
}
```

## 2. Add custom validation (optional)

Anything the tags can't express goes into a `Validate` method. It runs after binding, before the handler; an error is a usage error (exit code 2):

```go
func (o DeployOptions) Validate() error {
	if o.Env == "prod" && len(o.Services) > 1 {
		return errors.New("deploy one service at a time in prod")
	}
	return nil
}
```

## 3. Write handlers and assemble the app

Handlers are plain functions; the options type is inferred from the signature:

```go
func runServe(ctx context.Context, opts ServeOptions) error { /* ... */ return nil }
func runDeploy(ctx context.Context, opts DeployOptions) error { /* ... */ return nil }

func newApp() *scmd.App {
	cfg, _ := sconf.New().
		AddJSONFile("appsettings.json", sconf.Optional()).
		AddEnvironmentVariables("DEPL_").
		Build()

	return scmd.New("depl", "Deploy utility",
		scmd.WithLocale(scmd.LocaleEN),
		scmd.WithConfiguration(cfg),
		scmd.WithVersion("1.0.0"),
		scmd.Cmd("serve", "Run the server", runServe),
		scmd.Cmd("deploy", "Deploy services", runDeploy).
			With(scmd.Aliases("d")),
		scmd.Group("secrets", "Manage secrets",
			scmd.Cmd("list", "List secrets", runSecretsList),
			scmd.Cmd("set", "Store a secret", runSecretsSet),
		),
	)
}

func main() {
	os.Exit(newApp().Run(context.Background(), os.Args[1:]))
}
```

Note there are no package-level variables and no `init()` — `newApp()` builds a fresh, independent app every time it is called. That single property is what makes testing trivial.

## 4. Run it

```sh
$ depl deploy --env stage -l team=core,tier=1 --dry-run api
$ depl d --env=prod api web        # alias + validation error, exit code 2
deploy one service at a time in prod
See "depl deploy --help".
$ DEPL_TIMEOUT=1m depl serve app.json   # env layer
$ depl sevre                            # typo
depl: unknown command "sevre"
Did you mean "serve"?
```

Flags may appear before the command name too (`depl -v deploy api`); a flag *value* before the command name must use the `--flag=value` form so it is not mistaken for a command.

## 5. Test it

`scmdtest` runs the app with captured output — no `os.Stdout` juggling, no state reset, parallel-safe:

```go
func TestProdDeploysOneService(t *testing.T) {
	t.Parallel()
	res := scmdtest.Run(newApp(), "deploy", "--env", "prod", "api", "web")
	if res.ExitCode != 2 || !strings.Contains(res.Stderr, "one service at a time") {
		t.Fatalf("code %d, stderr: %s", res.ExitCode, res.Stderr)
	}
}

// One line proves every tag, default and enum in the whole CLI:
func TestCLIContract(t *testing.T) { newApp() }
```

## Where to go next

- [Commands](./commands.md) — root commands, hidden/deprecated, flag groups, help groups.
- [Configuration layers](./configuration.md) — how argv, env, sconf and defaults interact.
- [Tags reference](./tags.md) — the full tag and type table.
