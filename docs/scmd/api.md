# API Reference

Package `github.com/dvislobokov/scmd`. Everything below is the complete exported surface (v1.1.0).

## Building an app

```go
func New(name, desc string, items ...AppItem) *App
```

Constructs the app, applies items (commands and options in any order), validates every command's tag contract fail-fast, and auto-registers the `completion` and hidden `__complete` commands unless already defined.

```go
type App struct{ /* unexported */ }

func (a *App) Run(ctx context.Context, argv []string) int
func (a *App) SetOutput(stdout, stderr io.Writer)
func (a *App) GenMarkdownTree(dir string) error
func (a *App) GenManTree(dir string) error
```

`Run` returns the exit code: `0` success, `1` handler error, `2` usage error. Typical main: `os.Exit(app.Run(context.Background(), os.Args[1:]))`.

```go
type AppItem interface{ /* unexported */ }
type Option  struct{ /* unexported */ }   // an AppItem

func WithConfiguration(cfg *sconf.Config) Option  // argv > env > sconf > default
func WithOutput(stdout, stderr io.Writer) Option
func WithVersion(v string) Option                 // enables --version / -V
func WithLocale(l Locale) Option                  // default LocaleRU
func WithoutUsageHints() Option                   // suppress `See "... --help".`
```

## Commands

```go
func Cmd[T any](name, desc string, run func(ctx context.Context, opts T) error) *Command
func Group(name, desc string, children ...*Command) *Command
func Root(cmd *Command) AppItem   // make the app root executable

type Command struct{ /* unexported */ }
func (c *Command) With(opts ...CmdOption) *Command
```

`T` is the options struct; its tags are validated inside `Cmd` (panic on contract errors). Type inference from the handler means `Cmd[T]` is never spelled explicitly.

```go
type CmdOption func(*Command)

func Aliases(names ...string) CmdOption
func HiddenCmd() CmdOption
func DeprecatedCmd(msg string) CmdOption
func HelpGroup(title string) CmdOption
func PassUnknownFlags() CmdOption
func MutuallyExclusive(flags ...string) CmdOption
func RequiredTogether(flags ...string) CmdOption
func OneRequired(flags ...string) CmdOption
```

## Field types

```go
type Count int
```

Occurrence-counting flag: `-vvv` → 3, `--verbose=2` → 2.

```go
type Value[T any] struct{ /* unexported */ }

func (v Value[T]) Get() T
func (v Value[T]) IsSet() bool     // true for argv/env/sconf; false for default/none
func (v Value[T]) Source() Source

type Source int
const (
	SourceNone Source = iota
	SourceDefault
	SourceConf
	SourceEnv
	SourceArgv
)
func (s Source) String() string
```

`T` must be a scalar (including `time.Duration` and `encoding.TextUnmarshaler` implementors).

## Validation and errors

```go
type Validator interface{ Validate() error }
```

Implemented by an options struct (value or pointer receiver); runs after binding, before the handler. Errors become usage errors.

```go
type UsageError struct{ Problems []string }
func (e *UsageError) Error() string
```

Return `*UsageError` from a handler for exit code 2 with the `--help` hint; every binding problem is collected into one.

## Localization

```go
type Locale struct{ /* ~50 exported string fields */ }
var LocaleRU Locale   // default
var LocaleEN Locale
```

All user-facing strings: help section titles, flag annotations, usage errors, value-parse errors, warnings, suggestion text, auto-command descriptions. Copy a stock catalog and override fields for a custom translation.

## Package scmdtest

```go
import "github.com/dvislobokov/scmd/scmdtest"

type Result struct {
	ExitCode int
	Stdout   string
	Stderr   string
}

func Run(app *scmd.App, args ...string) Result
func RunContext(ctx context.Context, app *scmd.App, args ...string) Result
```

Runs the app with captured output. Safe for parallel tests — the app carries no global state.
