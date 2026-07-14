# Usage and Help

sconf generates command-line help directly from your configuration struct — the same tags that drive binding (`default`, `enum`, `description`/`usage`) produce the `--help` output, so it can never drift from the code.

## Built-in `--help` handling

`sconf.Load[T]` checks the argument list before doing anything else. If a help flag is present, it prints the generated usage to stdout and returns `sconf.ErrHelp`:

```go
cfg, err := sconf.Load[Config](sconf.New(), os.Args[1:])
switch {
case errors.Is(err, sconf.ErrHelp):
	os.Exit(0) // usage already printed to stdout by Load
case err != nil:
	log.Fatal(err)
}
```

Recognized help flags (checked by `sconf.HelpRequested`):

```txt
-h  --h  -help  --help  -?  /?  /help  /h
```

Passing `nil` as `args` disables both the help check and the command-line layer.

## `--help --format` — machine-readable help {#help-format}

Next to any help flag you can pass `--format table|env|json|yaml|toml` (or `--format=env`):

- `table` (or no `--format`) — the human-readable listing shown below, identical to `Usage[T]()`.
- `env` — a ready-to-fill `.env` template: a comment line per key (`# <description> (<type>[, one of a|b][, default "x"])`) followed by `NAME=<default>`. Variable names use the builder's environment prefix and `__` notation (slice placeholders render as `SERVERS__N__HOST`); a field with an [`env:"NAME"` tag](./environment-variables.md#binding-one-field-to-a-named-variable) renders as its exact name, without prefix.
- `json` / `yaml` / `toml` — the schema as structured entries with `key`, `env`, `type`, `default`, `enum`, and `description` fields (TOML wraps them in an `[[options]]` array).

```sh
go run . --help --format env
```

```txt
# SMTP relay endpoint (string, default "https://mail.example.com")
APP_ENDPOINT=https://mail.example.com
# delivery mode (string, one of digest|instant, default "instant")
APP_MODE=instant
```

The environment prefix is taken from the first `AddEnvironmentVariables` provider in the builder (empty when there is none). An unknown format is an error — `Load` returns `config: unknown help format "..." (want table|env|json|yaml|toml)` (not `ErrHelp`) and prints nothing.

Programmatically the same output comes from `UsageFormat`:

```go
out, err := sconf.UsageFormat[Config]("env", "APP_")
```

## `UsageHandler[T]` — the schema as an HTTP endpoint

`UsageHandler[T](envPrefix)` serves the same schema over HTTP — a standard `http.Handler`, so it plugs into any router:

```go
mux.Handle("/config/usage", sconf.UsageHandler[Config]("APP_"))       // net/http
r.GET("/config/usage", gin.WrapH(sconf.UsageHandler[Config]("APP_"))) // gin
e.GET("/config/usage", echo.WrapHandler(sconf.UsageHandler[Config]("APP_")))
```

```sh
curl localhost:8080/config/usage?format=env
```

The `format` query parameter selects the output (the same five formats, `table` by default); the response is always bare `text/plain`. `envPrefix` plays the same role as in `UsageFormat`. Only the *schema* is served — keys, types, defaults, enums, descriptions — no configuration values leave the process. An unknown format returns `400`; methods other than GET/HEAD return `405`.

## Example

A notification dispatcher:

```go
type Config struct {
	Endpoint string `name:"endpoint" default:"https://mail.example.com" description:"SMTP relay endpoint"`
	Mode     string `enum:"digest,instant" default:"instant" usage:"delivery mode"`

	Retry struct {
		Max     int           `default:"3" description:"max delivery attempts"`
		Backoff time.Duration `default:"2s" description:"pause between attempts"`
	}

	Channels []string `description:"channels to enable"`
}
```

```sh
go run . --help
```

```txt
Options:
  --endpoint       string  (default "https://mail.example.com")  SMTP relay endpoint
  --Mode           string  {digest|instant}  (default "instant")  delivery mode
  --Retry:Max      int  (default "3")  max delivery attempts
  --Retry:Backoff  duration  (default "2s")  pause between attempts
  --Channels       []string  channels to enable
```

Points to note, all visible above:

- Keys are shown in command-line form (`--section:key`), using the tag name where one exists (`endpoint`) and the Go field name otherwise (`Mode`, `Retry:Max`). Matching stays case-insensitive either way.
- Enums render as `{a|b}`, defaults as `(default "...")`, and the text comes from `description` (or `usage` when `description` is absent).
- `time.Duration` renders as `duration`, `time.Time` as `datetime`, slices as `[]<type>`.
- Nested structs are flattened into their leaf keys. For a slice of structs the placeholder key is `parent:N:field`; for a map of structs it is `parent:<key>:field`.
- A field with an `env:"NAME"` tag additionally shows `(env NAME)` after its default.

## `Usage[T]` — the help text as a string

`Load` prints usage for you, but you can also render it yourself (for a custom help layout, embedding into a bigger help screen, etc.):

```go
fmt.Print(sconf.Usage[Config]())
```

## `Describe[T]` — programmatic metadata

`Describe[T]` returns the same information as structured data — one `UsageEntry` per leaf key:

```go
type UsageEntry = bind.Entry // Key, Type, Default, HasDefault, Enum, Description, EnvVar

for _, e := range sconf.Describe[Config]() {
	fmt.Printf("key=%-15s type=%-8s default=%-25q enum=%v\n",
		e.Key, e.Type, e.Default, e.Enum)
}
```

```txt
key=endpoint        type=string   default="https://mail.example.com" enum=[]
key=Mode            type=string   default="instant"                 enum=[digest instant]
key=Retry:Max       type=int      default="3"                       enum=[]
key=Retry:Backoff   type=duration default="2s"                      enum=[]
key=Channels        type=[]string default=""                        enum=[]
```

Use it to generate documentation, validate deployment manifests, or build your own flag-style interface on top of sconf.

::: tip
`Entry.HasDefault` distinguishes "default is the empty string" from "no default at all" — check it rather than comparing `Default` to `""`.
:::
