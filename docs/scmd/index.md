# scmd

scmd is a type-safe CLI framework for Go in the spirit of dotnet's `CommandLineParser` — and an answer to cobra's pain points. A command is described by a plain options struct with tags; the handler receives an already populated, validated, typed value. No global state, no `init()`, no stringly `GetString("name")` lookups — and configuration layering over [sconf](/sconf/) replaces the entire cobra+viper dance with one option.

## Why scmd

- **Options are structs, not strings.** Declare `Port int \`flag:"port" default:"8080"\`` once; read `opts.Port` — typed, compiler-checked, impossible to typo at the call site.
- **The handler defines the command.** `scmd.Cmd("serve", "...", runServe)` infers the options type from the handler signature. No `[T]` to spell out, no boilerplate files, no `init()`.
- **Zero global state.** An app is a plain value. Build it as many times as you like; tests run in parallel with no flag-reset rituals.
- **Configuration layering built in.** With `WithConfiguration(cfg)`, a flag resolves as `argv > env (tag) > sconf (tag) > default` — including YAML lists and maps into slice and map flags. This is the cobra+viper integration everyone hand-rolls, as one line.
- **`scmd.Value[T]` knows where a value came from.** `Get()`, `IsSet()`, `Source()` — the `flag.Changed` idiom without a flag registry, perfect for "explicit flags override the config file" logic.
- **Fail-fast contract.** Every tag, default and enum across all commands is validated when the app is constructed. One smoke test of `newApp()` proves the whole CLI. A malformed `default:"8o80"` is a panic at build time, not a runtime surprise.
- **All errors at once.** Like CommandLineParser, parse and binding problems are collected and reported together, with exit code 2 and a `--help` hint.
- **Batteries from cobra, without the baggage.** Nested verbs, aliases, hidden and deprecated commands and flags, mutually-exclusive / required-together flag groups, "did you mean?" suggestions, shell completion for bash/zsh/fish/powershell, man and Markdown doc generation, `--version`.
- **Localized.** Every user-facing string lives in a `Locale` catalog — `LocaleEN`, `LocaleRU`, or bring your own translation.

Part of the `s*` family alongside [sconf](/sconf/) (configuration), [sorm](/sorm/) (ORM), [srog](/srog/) (logging), [shost](/shost/) (hosting) and [smsg](/smsg/) (messaging). [protogen](/protogen/)'s CLI is built on scmd.

## Installation

```sh
go get github.com/dvislobokov/scmd   # Go 1.24+, brings sconf for the config layer
```

## A minimal example

```go
package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/dvislobokov/scmd"
	"github.com/dvislobokov/sconf"
)

type ServeOptions struct {
	Port    int           `flag:"port" short:"p" default:"8080" conf:"server.port" help:"HTTP port"`
	Timeout time.Duration `flag:"timeout" default:"30s" env:"APP_TIMEOUT" help:"Request timeout"`
	Config  string        `arg:"config" required:"true" help:"Path to the app config"`
}

func runServe(ctx context.Context, opts ServeOptions) error {
	fmt.Printf("serving :%d (timeout %s, config %s)\n", opts.Port, opts.Timeout, opts.Config)
	return nil
}

func main() {
	cfg, _ := sconf.New().
		AddJSONFile("appsettings.json", sconf.Optional()).
		AddEnvironmentVariables("APP_").
		Build()

	app := scmd.New("demo", "A demo service",
		scmd.WithLocale(scmd.LocaleEN),
		scmd.WithConfiguration(cfg),
		scmd.WithVersion("1.0.0"),
		scmd.Cmd("serve", "Run the server", runServe),
	)
	os.Exit(app.Run(context.Background(), os.Args[1:]))
}
```

`demo serve --help`, `demo --version`, shell completion and typo suggestions all work out of the box. `--port` beats `APP_TIMEOUT`-style env vars, which beat `appsettings.json`, which beats the tag default.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | success |
| `1` | the handler returned an error |
| `2` | usage error: unknown flag/command, missing required value, failed validation |

## Where to go next

- [Quick start](./quick-start.md) — a multi-command CLI with tests in five minutes.
- [Commands](./commands.md) — verbs, groups, root commands, aliases, flag groups.
- [Tags reference](./tags.md) — every struct tag and supported field type.
- [Configuration layers](./configuration.md) — sconf, env, `Value[T]` and source tracking.
- [Completion, docs, localization](./completion-docs.md) — shell completion, man/Markdown generation, locales.
- [Testing](./testing.md) — `scmdtest` and the one-line contract smoke test.
- [API reference](./api.md) — every exported symbol.

Source: [github.com/dvislobokov/scmd](https://github.com/dvislobokov/scmd)
