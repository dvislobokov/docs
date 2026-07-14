# Providers and Layering

A provider is any source of configuration. Each one implements a single-method interface and returns flat `path → value` pairs; the `Builder` merges them in the order they were added.

```go
type Provider interface {
	Load() (map[string]string, error)
}
```

## The flat model

Every source is flattened to string keys with `:` separating path segments:

| Source input | Flat key |
|---|---|
| YAML `database: { host: db1 }` | `database:host` |
| JSON `{"servers": [{"port": 8080}]}` | `servers:0:port` |
| Env var `APP_SERVERS__0__PORT` (prefix `APP_`) | `servers:0:port` |
| CLI `--servers:0:port=8080` | `servers:0:port` |

Keys are **case-insensitive**: they are normalized to lower case when stored, and lookups normalize too. The original spelling is preserved for error messages.

## Layering and precedence

`Builder.Build()` loads providers in order and applies each layer's keys on top of the previous ones — **last writer wins, per key**. A later layer only replaces the keys it actually defines; everything else shines through.

```go
builder := sconf.New().
	AddInMemory(map[string]string{ // 1: hard-coded fallbacks (lowest)
		"currency":        "USD",
		"gateway:retries": "1",
	}).
	AddJSONFile("appsettings.json").                              // 2: base file
	AddYAMLFile("appsettings.production.yaml", sconf.Optional()). // 3: env-specific overlay
	AddEnvironmentVariables("PAYFLOW_")                           // 4: environment

cfg, err := sconf.Load[Config](builder, os.Args[1:]) // 5: command line (highest)
```

::: info
`sconf.Load` appends the command-line layer itself (when `args` is non-empty), so the CLI always has the highest priority. Just below it, `Load` inserts a layer for fields bound to a named variable via the [`env:"NAME"` tag](./environment-variables.md#binding-one-field-to-a-named-variable). Struct-tag `default` values are not a layer at all — they apply during binding, only when no source provided the key.
:::

With this base file and overlay:

::: code-group

```json [appsettings.json]
{
  "currency": "EUR",
  "fee_percent": 1.4,
  "gateway": {
    "endpoint": "https://sandbox.pay.example",
    "timeout": "10s",
    "retries": 3
  }
}
```

```yaml [appsettings.production.yaml]
gateway:
  endpoint: https://live.pay.example
```

:::

```sh
PAYFLOW_CURRENCY=CHF PAYFLOW_GATEWAY__TIMEOUT=5s go run . --gateway:retries=7
```

```txt
currency=CHF fee=1.40%
gateway: endpoint=https://live.pay.example timeout=5s retries=7
```

`endpoint` came from the overlay file, `currency` and `timeout` from the environment, `retries` from the command line, and `fee_percent` from the base JSON — each key resolved independently.

## File providers: JSON, YAML, TOML

```go
sconf.New().
	AddJSONFile("appsettings.json").
	AddYAMLFile("appsettings.yaml").
	AddTOMLFile("appsettings.toml")
```

All three parse the file into a tree and flatten it. Details worth knowing:

- JSON numbers are decoded with `UseNumber`, so the original textual representation is preserved (no float round-tripping).
- An empty (or whitespace-only) file yields an empty layer, not an error.
- Read failures are wrapped as `config: read "<path>": ...`; parse failures as `config: parse "<path>": ...`.

The equivalent constructors are also available directly as `provider.JSONFile`, `provider.YAMLFile`, and `provider.TOMLFile`.

### File options: Optional, Wait, PollInterval

Every file provider accepts options (re-exported from `sconf/provider` as `sconf.Optional`, `sconf.Wait`, `sconf.PollInterval`):

| Option | Effect |
|---|---|
| `Optional()` | A missing file (or one that never appears during `Wait`) contributes an empty layer instead of failing the build. |
| `Wait(timeout)` | Block in `Load` until the file exists on disk. `timeout == 0` waits forever. If the timeout elapses, the error is `config: file "<path>" did not appear within <timeout>` (unless the file is also `Optional`). |
| `PollInterval(d)` | How often the filesystem is polled while waiting. Default: 200 ms (non-positive values fall back to the default). |

`Wait` is designed for files rendered by a sidecar or init container (a Vault agent token, for example). A directory at the path does not count as the file existing.

```go
cfg, err := sconf.Load[Config](
	sconf.New().
		AddInMemory(map[string]string{"broker": "amqp://mq.internal:5672"}).
		AddYAMLFile(tokenFile,
			sconf.Wait(2*time.Second),                // block until the file appears
			sconf.PollInterval(50*time.Millisecond)). // check every 50ms
		AddYAMLFile("local-overrides.yaml", sconf.Optional()), // fine if missing
	nil,
)
```

Verified output (the file is written by another goroutine 300 ms after startup):

```txt
broker=amqp://mq.internal:5672 token=t-9f2c
waited at least 300ms: true
```

## Environment variables

```go
sconf.New().AddEnvironmentVariables("MYAPP_")
```

The prefix (which may be empty) is stripped from the variable name; variables without the prefix are ignored; `__` becomes `:`. See [Environment variables](./environment-variables.md) for the full treatment, including arrays of objects.

## .env files

```go
sconf.New().
	AddYAMLFile("appsettings.yaml").
	AddDotEnvFile(".env", "APP_", sconf.Optional()). // skipped when absent (CI, prod)
	AddEnvironmentVariables("APP_")                  // real env still wins
```

`AddDotEnvFile(path, prefix, opts...)` reads `KEY=VALUE` lines and treats them exactly like environment variables: the prefix (which may be empty) is stripped, keys without it are skipped, and `__` becomes `:`. The real process environment is **not** touched — the file is just another configuration layer, so precedence follows its position in the builder as usual. Typical use: a developer-local `.env` layered between the base file and the real environment.

It is built on the same file provider as JSON/YAML/TOML, so `Optional()`, `Wait(timeout)`, and `PollInterval(d)` all apply, with the same wrapped read/parse errors.

Supported syntax:

```sh
# full-line comments and blank lines
APP_DATABASE__HOST=localhost
export APP_DATABASE__PORT=5432        # optional export prefix; trailing comments after a space
APP_GREETING="hello\nworld"           # double quotes expand \n \t \r \" \\
APP_TOKEN='as $is'                    # single quotes are fully literal
```

Not supported: multiline values and variable interpolation. Malformed lines produce positional errors such as `dotenv: line 3: missing '='` or `dotenv: line 7: unterminated quoted value`.

The constructor is also available directly as `provider.DotEnvFile`.

::: warning
A `.env` containing `VAULT_ADDR`, `VAULT_TOKEN`, etc. does **not** configure sconf's Vault client — [Vault settings](./vault.md) are read from real process environment variables only.
:::

## Command line

```go
sconf.New().AddCommandLine(os.Args[1:])
```

Usually you never call this yourself — `sconf.Load` adds it for you. The parser accepts:

```txt
--key=value    --key value    -key=value    -key value    /key=value    /key value
```

- `__` in the key converts to `:` (so `--limits__process_timeout=20s` and `--limits:process_timeout=20s` are equivalent).
- Positional arguments are ignored.
- The space-separated form consumes the next argument as the value only if it does not itself start with `-` or `/`; a flag with no value is stored as an empty string.

## In-memory values

```go
sconf.New().AddInMemory(map[string]string{
	"database:host": "localhost",
	"database:port": "5432",
})
```

Keys may use the `:` separator directly. Useful for hard-coded fallbacks (add it first) or tests. The map is copied, so later mutation of your map does not affect the builder.

## Custom providers

Anything with `Load() (map[string]string, error)` can be a layer via `Builder.Add`:

```go
sconf.New().
	AddYAMLFile("farm.yaml").
	Add(dotenvProvider{path: "overrides.env"}) // your own source
```

See [Advanced](./advanced.md#writing-a-custom-provider) for a complete, verified custom provider, and [Vault secrets](./vault.md#the-vault-kv-configuration-layer) for the ready-made `AddVaultKV` layer that merges a Vault KV secret into the tree.
