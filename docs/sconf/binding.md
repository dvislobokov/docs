# Struct Binding

`sconf.Load[T]` binds the merged flat configuration into a freshly allocated `*T` using reflection. This page covers the supported field types, the tag vocabulary, and the binder's rules — all verified against a running program.

## Entry points

```go
func Load[T any](b *Builder, args []string) (*T, error)
func LoadContext[T any](ctx context.Context, b *Builder, args []string) (*T, error)
```

`Load` calls `LoadContext` with `context.Background()`. The context bounds the initial Vault requests and the lifetime of the background secret refresh (cancelling it stops the refresh goroutines); the binder itself is synchronous. If `args` contains a help flag, usage is printed to stdout and `ErrHelp` is returned. `Load` then layers two things on top of the builder's providers: values of environment variables named by [`env:"NAME"` tags](./environment-variables.md#binding-one-field-to-a-named-variable), and — when `args` is non-empty — the command-line layer, which has the highest priority.

The lower-level `bind.Bind(m, prefix, target)` exists for advanced use, but it takes the internal flat map, so in practice you always go through `Load`.

::: warning
`bind.Bind` panics if `target` is not a non-nil pointer — that is treated as a programmer error, not a runtime condition. `Load` always passes a valid pointer.
:::

## Key names and tags

The key for a field is taken from the first present tag among `json`, `yaml`, `toml`, `name` — in that priority order — otherwise the Go field name is used. Anything after a comma in the tag (`,omitempty` etc.) is ignored.

| Tag | Purpose |
|---|---|
| `json` / `yaml` / `toml` / `name` | Key name (first one present wins). A value of `-` skips the field entirely. |
| `default` | Fallback value, applied when no source provides the key. Parsed like any other value. |
| `enum` | Comma-separated allowed values. Matched case-insensitively; the bound value is canonicalized to the spelling in the list. Violations return `ErrEnum`. |
| `description` / `usage` | Human-readable text for [generated help](./usage-help.md). `description` wins if both are present. |
| `env` | Binds the field to one exact environment variable (no prefix, no `__` convention). Read by `Load`/`LoadContext` only; see [Environment variables](./environment-variables.md#binding-one-field-to-a-named-variable). |

Additional skip rules: unexported fields are always ignored, and matching is case-insensitive (a YAML key `Name` binds a field keyed `name`).

## Supported field types

Verified with a document-archiving service config:

```go
// Common is embedded without a tag: its fields are promoted to the parent level.
type Common struct {
	Region string `yaml:"region" default:"eu-west-1"`
}

type Store struct {
	Bucket string `yaml:"bucket"`
	Quota  uint64 `yaml:"quota"`
}

type Config struct {
	Common // embedded, promoted: key is "region", not "common:region"

	Name       string        `yaml:"name"`
	MaxRetries int           `yaml:"max_retries"`
	Ratio      float64       `yaml:"ratio"`
	Verbose    bool          `yaml:"verbose"`
	Scan       time.Duration `yaml:"scan"`
	Since      time.Time     `yaml:"since"`
	LaunchedAt time.Time     `yaml:"launched_at"`

	// Pointer fields stay nil unless a value (or default) exists.
	PageSize *int `yaml:"page_size"`
	Shards   *int `yaml:"shards"`
	Batch    *int `yaml:"batch" default:"100"` // default allocates the pointer

	Stores map[string]Store  `yaml:"stores"` // map of structs
	Labels map[string]string `yaml:"labels"` // map of scalars

	// Tag priority: json > yaml > toml > name. Key here is "codename".
	Internal string `json:"codename" yaml:"ignored_name"`

	Skipped  string `json:"-"` // never bound
	internal string // unexported: ignored
}
```

Given a YAML file supplying these keys (including deliberately mis-cased `Name:`), the program prints:

```txt
name=doc-archive region=eu-west-1 retries=5 ratio=0.75 verbose=true
scan=2m30s since=2026-07-01 launched=2026-07-13T08:30:00Z
page_size=250 shards=<nil> batch=100
stores=map[cold:{docs-cold 1099511627776} hot:{docs-hot 10737418240}] labels=map[team:records tier:internal]
codename="heron" skipped=""
```

### Type-by-type rules

| Type | Behavior |
|---|---|
| `string` | Value as-is (scalars are whitespace-trimmed before conversion). |
| `bool` | `strconv.ParseBool` — `1`, `t`, `true`, `0`, `false`, ... |
| `int`, `int8`–`int64` | `strconv.ParseInt`, base 10. |
| `uint`, `uint8`–`uint64` | `strconv.ParseUint`, base 10. |
| `float32`, `float64` | `strconv.ParseFloat`. |
| `time.Duration` | `time.ParseDuration` — `45s`, `2m30s`, `1h15m`. |
| `time.Time` | First matching layout of `RFC3339Nano`, `RFC3339`, `2006-01-02T15:04:05`, `2006-01-02`. |
| Pointers | Allocated only if a value or a `default` exists; otherwise left `nil` — a clean "not set" signal. |
| Structs | Each field bound at `path:fieldkey`. |
| Embedded structs | Promoted to the parent level when anonymous and untagged; an explicit name tag turns them into a nested section. |
| Slices | Built from numeric child segments, sorted ascending, holes collapsed. Elements may be scalars or structs. |
| Maps | Key type must be `string` (otherwise `ErrBindType`); one entry per child segment; values may be scalars or structs. Map keys are the *normalized* (lower-case) segments. |
| Types implementing `Unmarshaler` | The custom `UnmarshalConfig(string)` is used instead of reflection — see [Advanced](./advanced.md#custom-parsing-with-unmarshaler). |

Failures to convert return an error wrapping `sconf.ErrBindType` with the key path, the offending value, and the target type — see [Error handling](./errors.md).

## Defaults

The `default` tag applies during binding, per field, only when the merged configuration has no value for the key. It is parsed exactly like a source value, so `default:"30s"` on a `time.Duration` and `default:"100"` on an `*int` both work (the latter allocates the pointer).

## Enums

`enum:"debug,info,warn,error"` validates the effective value (from sources *or* from `default`) case-insensitively and canonicalizes it:

```go
type Config struct {
	Mode string `enum:"dev,prod" default:"dev"`
}
```

A source value of `PROD` binds as `prod`; a value of `staging` fails:

```txt
config: "Mode" = "staging": config: value not allowed (allowed: dev, prod)
```

## Validation

Any addressable value whose pointer implements `Validator` is checked after it has been bound:

```go
type Validator interface {
	Validate() error
}
```

Validation runs for structs, slices, maps, and scalars alike; a failure is wrapped as `config: validate "<path>": <your error>`. See [Advanced](./advanced.md#self-validation-with-validator) for a verified example.
