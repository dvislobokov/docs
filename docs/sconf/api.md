# API Reference

The complete exported surface of `github.com/dvislobokov/sconf` and its subpackages, grouped by package. Signatures are taken verbatim from the source.

## Package `sconf`

The root package: the builder, the merged configuration, the generic entry points, help generation, and re-exports of the most-used symbols from `sconf/bind` and `sconf/provider`.

### Loading

```go
func Load[T any](b *Builder, args []string, opts ...LoadOption) (*T, error)
func LoadContext[T any](ctx context.Context, b *Builder, args []string, opts ...LoadOption) (*T, error)
```

The main entry point. In order: prints usage (including the built-in flags section) and **exits the process with code 0** if `args` contains a help flag (honoring `--help --format ...`; an unknown format returns an error instead of exiting); layers the values of environment variables named by `env:"NAME"` tags above the builder's providers; appends `args` as the highest-priority command-line layer (when non-empty); builds the merged configuration; binds it into a new `*T`; resolves secret fields from Vault; starts background refresh for every refreshable secret. `args` is usually `os.Args[1:]`; pass `nil` to skip both the CLI layer and the help check.

The context passed to `LoadContext` bounds both the initial Vault requests and the **lifetime of the background refresh**: cancelling it stops the refresh goroutines. `Load` uses `context.Background()`, so secrets are refreshed for the lifetime of the process — nothing to stop or manage.

```go
cfg, err := sconf.Load[Config](
	sconf.New().
		AddYAMLFile("appsettings.yaml", sconf.Optional()).
		AddEnvironmentVariables("APP_"),
	os.Args[1:],
)
```

### type Builder

```go
type Builder struct{ /* unexported */ }

func New() *Builder
func (b *Builder) Add(p Provider) *Builder
func (b *Builder) AddJSONFile(path string, opts ...FileOption) *Builder
func (b *Builder) AddYAMLFile(path string, opts ...FileOption) *Builder
func (b *Builder) AddTOMLFile(path string, opts ...FileOption) *Builder
func (b *Builder) AddDotEnvFile(path, prefix string, opts ...FileOption) *Builder
func (b *Builder) AddEnvironmentVariables(prefix string) *Builder
func (b *Builder) AddCommandLine(args []string) *Builder
func (b *Builder) AddInMemory(values map[string]string) *Builder
func (b *Builder) AddVaultKV(path string) *Builder
func (b *Builder) AddVaultKVAt(path, section string) *Builder
func (b *Builder) Build() (*Config, error)
```

Collects providers in order; `Build` loads each one and merges the results last-wins per key. All `Add*` methods return the builder for chaining.

`AddDotEnvFile` reads `KEY=VALUE` lines and treats them like environment variables (prefix stripped, `__` → `:`) without touching the process environment; it accepts the same `FileOption`s as the other file providers. See [.env files](./providers.md#env-files).

`AddVaultKV` layers the fields of one Vault KV secret into the configuration tree (full path; the KV v2 `data`/`metadata` envelope is unwrapped, nested objects and lists flatten like any other source). `AddVaultKVAt` places the fields under a section prefix instead of the root. Connection settings come from the same environment variables as secret fields, and `VAULT_SECRETS_FILE` is honored for local development. See [Vault secrets](./vault.md#the-vault-kv-configuration-layer).

### type Config

```go
type Config struct{ /* unexported */ }

func (c *Config) Get(key string) (string, bool)
func (c *Config) GetString(key string) string
func (c *Config) GetInt(key string, def int) int
func (c *Config) GetBool(key string, def bool) bool
func (c *Config) Exists(key string) bool
func (c *Config) Section(key string) *Config
func (c *Config) GetChildren(key string) []string
```

The merged configuration: case-insensitive, safe for concurrent reads. Keys are hierarchical (`database:host`). `GetInt`/`GetBool` return `def` when the key is missing or unparsable. `Section` returns a prefix-restricted view sharing the same data. `GetChildren` returns immediate child segments, normalized and sorted.

### type Provider

```go
type Provider interface {
	Load() (map[string]string, error)
}
```

Any configuration source. Returns flat `path → value` pairs with `:` as the separator. See [Advanced](./advanced.md#writing-a-custom-provider).

### Usage and help

```go
func Usage[T any]() string
func UsageFormat[T any](format, envPrefix string) (string, error)
func UsageHandler[T any](envPrefix string) http.Handler
func Describe[T any]() []UsageEntry
func HelpRequested(args []string) bool

type UsageEntry = bind.Entry
```

`Usage` renders human-readable help from `T`'s fields and tags (keys shown as `--section:key`). `UsageFormat` renders the same schema in one of `table`, `env`, `json`, `yaml`, `toml` — the machinery behind `--help --format`; `envPrefix` names variables in the `env` format. `UsageHandler` serves the schema over HTTP (`?format=...`, plain text, schema only — no values). `Describe` returns the same data structured. `HelpRequested` reports whether `args` contains `-h`, `--h`, `-help`, `--help`, `-?`, `/?`, `/help`, or `/h`. See [Usage and help](./usage-help.md).

### Dumping

```go
type DumpFormat string

const (
	DumpKeys DumpFormat = "keys"
	DumpEnv  DumpFormat = "env"
	DumpJSON DumpFormat = "json"
	DumpYAML DumpFormat = "yaml"
	DumpTOML DumpFormat = "toml"
)

type DumpOption func(*dumpOptions)

func WithDumpEnvPrefix(prefix string) DumpOption
func WithDumpRedact(keys ...string) DumpOption

func Dump[T any](cfg *Config, format DumpFormat, opts ...DumpOption) (string, error)
func DumpValues(cfg *Config, format DumpFormat, opts ...DumpOption) (string, error)
```

Render the final merged configuration; `T`'s `description`/`usage` tags become comments in the `keys`/`env` formats, `DumpValues` omits them. `WithDumpRedact` masks keys (and their subtrees) as `***`. See [Advanced](./advanced.md#dumping-the-merged-configuration).

### Secrets and background refresh

```go
var ErrVaultNotConfigured error // wraps "vault: not configured"

type LoadOption func(*loadOptions)

func WithSecretErrorHandler(fn func(error)) LoadOption
func WithSecretRetryBackoff(d time.Duration) LoadOption
func WithVaultWait(timeout time.Duration) LoadOption
func WithVaultWaitInterval(d time.Duration) LoadOption
```

Vault support is built in: `Load` fills every field implementing `secret.Resolvable` after binding and starts their background refresh — no imports or registration required. If the target has no secret fields, Vault is never contacted. If secret fields exist but the environment is not configured, `Load` fails with an error wrapping `ErrVaultNotConfigured`.

Refresh errors are silently swallowed by default (the previous value is kept); `WithSecretErrorHandler` observes them. `WithSecretRetryBackoff` sets the pause before retrying a failed refresh (default 30 s).

`WithVaultWait` gives the *initial* secret resolution a budget during which transient errors (network, HTTP 429/502/503/504) are retried; `WithVaultWaitInterval` sets the pause between attempts (default 2 s). The `VAULT_WAIT` / `VAULT_WAIT_INTERVAL` environment variables override the options and are the only way to enable waiting for `AddVaultKV` layers. See [Waiting for Vault at startup](./vault.md#waiting-for-vault-at-startup).

### Errors and aliases

```go
var ErrHelp = errors.New("config: help requested") // compat only: since v1.7.0 Load exits on --help itself
var ErrBindType = bind.ErrBindType
var ErrEnum = bind.ErrEnum

type Unmarshaler = bind.Unmarshaler
type Validator = bind.Validator
type FileOption = provider.FileOption

var (
	Optional     = provider.Optional
	Wait         = provider.Wait
	PollInterval = provider.PollInterval
)
```

Re-exports so typical applications import only `sconf`. See [Error handling](./errors.md).

## Package `sconf/provider`

The built-in sources. Each returns flat pairs; keys keep their original casing (normalization happens in the merged map).

### File sources

```go
func JSONFile(path string, opts ...FileOption) *fileProvider
func YAMLFile(path string, opts ...FileOption) *fileProvider
func TOMLFile(path string, opts ...FileOption) *fileProvider
func DotEnvFile(path, prefix string, opts ...FileOption) *fileProvider
```

Parse a file and flatten the tree. JSON numbers keep their source representation (`UseNumber`); empty files yield an empty layer. `DotEnvFile` parses `KEY=VALUE` lines with env-var semantics (prefix stripped, `__` → `:`); see [.env files](./providers.md#env-files).

### type FileOption

```go
type FileOption func(*fileOptions)

func Optional() FileOption
func Wait(timeout time.Duration) FileOption
func PollInterval(d time.Duration) FileOption
```

`Optional` — a missing file is not an error. `Wait` — block until the file appears (`timeout == 0` waits forever). `PollInterval` — polling cadence while waiting (default 200 ms). See [Providers](./providers.md#file-options-optional-wait-pollinterval).

### type EnvProvider

```go
type EnvProvider struct{ /* unexported */ }

func Env(prefix string) *EnvProvider
func (e *EnvProvider) WithEnviron(fn func() []string) *EnvProvider
func (e *EnvProvider) Prefix() string
func (e *EnvProvider) Load() (map[string]string, error)
```

Environment variables: the prefix (possibly empty) is stripped, `__` becomes `:`. `WithEnviron` substitutes the variable source — intended for tests. `Prefix` returns the configured prefix; `Load` uses it to pick the variable names for `--help --format env`.

### type ArgsProvider

```go
type ArgsProvider struct{ /* unexported */ }

func Args(args []string) *ArgsProvider
func (p *ArgsProvider) Load() (map[string]string, error)
```

Command-line arguments. Accepts `--key=value`, `--key value`, `-key=value`, `/key=value`, `/key value`; `__` becomes `:`; positional arguments are ignored; a flag directly followed by another flag gets an empty-string value.

### type MapProvider

```go
type MapProvider map[string]string

func Map(values map[string]string) MapProvider
func (p MapProvider) Load() (map[string]string, error)
```

Pre-set values (the input map is copied). Keys may contain `:`.

## Package `sconf/bind`

The reflection binder. Applications normally use it through `sconf.Load`; the aliases in the root package cover the common symbols.

```go
var ErrBindType = errors.New("config: cannot bind value to type")
var ErrEnum = errors.New("config: value not allowed")

type Unmarshaler interface {
	UnmarshalConfig(value string) error
}

type Validator interface {
	Validate() error
}

func Bind(m *flat.Map, prefix string, target interface{}) error
```

`Unmarshaler` is checked before reflection and receives `default` values too. `Validator` runs after a value is bound; failures are wrapped as `config: validate "<path>"`. `Bind` fills `target` (must be a non-nil pointer — panics otherwise) from the flat map under `prefix`; note the `flat` package is internal, so `Bind` is only callable with maps sconf itself built.

```go
type Entry struct {
	Key         string   // full path with ":" separators
	Type        string   // human-readable type ("string", "duration", "[]string", ...)
	Default     string   // value of the default tag
	HasDefault  bool     // whether default was set
	Enum        []string // allowed values (enum tag)
	Description string   // description tag, falling back to usage tag
	EnvVar      string   // explicit environment variable name (env tag)
}

func Describe(t reflect.Type) []Entry
func Usage(t reflect.Type) string
```

Non-generic versions of `sconf.Describe[T]` / `sconf.Usage[T]`, for when you have a `reflect.Type` instead of a type parameter.

## Package `sconf/secret`

Secret field types. Standard library only — the package describes *what* to fetch; the core's built-in Vault integration does the fetching. All concrete types implement `Unmarshaler` (they parse the path string from your config), `Resolvable`, and `Refreshable`, and their getters are safe for concurrent use.

### Interfaces and requests

```go
type Method int

const (
	Read  Method = iota // GET logical — DB/AD/KV/userpass reads
	Write               // PUT logical — e.g. pki/issue/<role>
)

type Request struct {
	Method  Method
	Path    string
	Data    map[string]any // body for Write requests
	Refresh time.Duration  // explicit ?refresh= interval (0 = resolver default)
}

type Resolvable interface {
	SecretRequest() Request
	Apply(data map[string]any) error
}

type Refreshable interface {
	Resolvable
	SetRefresh(d time.Duration)
	Refresh() time.Duration
}
```

Reserved path parameters (consumed by the resolver, never sent to Vault): `refresh`, `field`, `username_field`, `password_field`.

### type UserPass

```go
type UserPass struct{ /* unexported */ }

func (u *UserPass) UnmarshalConfig(value string) error
func (u *UserPass) SecretRequest() Request
func (u *UserPass) Apply(data map[string]any) error
func (u *UserPass) Username() string
func (u *UserPass) Password() string
func (u *UserPass) Resolved() bool
func (u *UserPass) Path() string
```

Username/password read from a full path. Username comes from `username` (override: `?username_field=`); password from `current_password` when present (Active Directory), else `password` (override: `?password_field=`). The KV v2 envelope (`data`/`metadata`) is unwrapped automatically.

With `?field=` (since v1.6.0), credentials are taken from a single text field of a KV secret: the field's text is parsed as JSON, then YAML, then TOML, and username/password are read from the parsed mapping (`username_field`/`password_field` apply to it). A missing field or unparsable text is an error.

```go
type Config struct {
	DB    secret.UserPass `yaml:"db"`    // yaml: db: database/creds/billing
	Redis secret.UserPass `yaml:"redis"` // yaml: redis: kv/data/secrets?field=redis
}
```

### type Cert

```go
type Cert struct{ /* unexported */ }

func (c *Cert) UnmarshalConfig(value string) error
func (c *Cert) SecretRequest() Request
func (c *Cert) Apply(data map[string]any) error
func (c *Cert) Certificate() string
func (c *Cert) PrivateKey() string
func (c *Cert) IssuingCA() string
func (c *Cert) CAChain() []string
func (c *Cert) SerialNumber() string
func (c *Cert) Resolved() bool
func (c *Cert) Path() string
```

A certificate issued by the Vault `pki` engine (a Write request). Path parameters other than the reserved ones become the issue-request body: `tls: pki/issue/web?common_name=app.example.com&ttl=24h`. Default refresh: ~70% of the certificate TTL.

### type KV

```go
type KV struct{ /* unexported */ }

func (k *KV) UnmarshalConfig(value string) error
func (k *KV) SecretRequest() Request
func (k *KV) Apply(data map[string]any) error
func (k *KV) Get(key string) string
func (k *KV) Values() map[string]string
func (k *KV) Resolved() bool
func (k *KV) Path() string
```

All fields of one KV secret as `key → string`. The KV v2 envelope is unwrapped automatically (use the `data` path segment: `secret/data/myapp`). `Values` returns a snapshot — do not mutate it; background refresh replaces it wholesale.

### type Value

```go
type Value struct{ /* unexported */ }

func (v *Value) UnmarshalConfig(value string) error
func (v *Value) SecretRequest() Request
func (v *Value) Apply(data map[string]any) error
func (v *Value) Get() string
func (v *Value) Resolved() bool
func (v *Value) Path() string
```

One field of a KV secret: `api_key: secret/data/myapp?field=api_key`. Without `?field=`, works only if the secret has exactly one field; otherwise `Apply` fails listing the available fields.

### func KVFields

```go
func KVFields(data map[string]any) map[string]any
```

Strips the KV v2 `data`/`metadata` envelope, returning the inner fields; KV v1 (and other engines') responses are returned unchanged. Exported for reuse by custom resolvers/providers.

## Vault integration (built-in)

Since v1.1.0 the Vault client lives in `sconf/internal/vault` and is wired into the core — there is no importable `sconf/vault` package and no separate `Load`/`Watch`/`Watcher` API. `sconf.Load` resolves secret fields and runs the background refresh internally; the refresh stops when the `LoadContext` context is cancelled (with `Load` it runs for the lifetime of the process). Connection settings come from environment variables — see the [table](./vault.md#environment-configuration).

The related public surface is in the root package: `ErrVaultNotConfigured`, `WithSecretErrorHandler`, `WithSecretRetryBackoff`, `Builder.AddVaultKV`, and `Builder.AddVaultKVAt` (all documented above).

### Refresh policy (behavioral reference)

- `?refresh=` on the secret path always wins.
- `secret.Cert`: ~70% of the lease/TTL; the 30-minute default when there is no lease.
- All other secret types: 30 minutes, or ~70% of the lease if shorter.
- Minimum interval: 10 seconds. Lease is taken from `lease_duration`, falling back to a `ttl` field in the response data (static roles).
