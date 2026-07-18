# Examples

A cookbook of complete, copy-paste-ready recipes for every part of sconf. Each example shows the inputs (files, environment, arguments), the code, and the exact result. For the underlying rules, follow the links into the reference pages.

[[toc]]

## 1. The smallest possible service

One YAML file, one struct, one call.

```yaml
# appsettings.yaml
listen: ":8080"
log_level: debug
```

```go
package main

import (
	"fmt"
	"log"
	"os"

	"github.com/dvislobokov/sconf"
)

type Config struct {
	Listen   string `yaml:"listen"`
	LogLevel string `yaml:"log_level"`
}

func main() {
	cfg, err := sconf.Load[Config](
		sconf.New().AddYAMLFile("appsettings.yaml"),
		os.Args[1:], // on --help, Load prints usage and exits the process
	)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(cfg.Listen, cfg.LogLevel) // :8080 debug
}
```

## 2. Layering: files → env → CLI, last one wins per key

Every source is a layer; later layers override earlier ones **key by key**, not file by file. See [Providers and Layering](./providers.md).

```yaml
# appsettings.yaml (base, committed)
listen: ":8080"
log_level: info
db:
  host: db.prod.internal
  port: 5432
```

```yaml
# appsettings.local.yaml (developer override, gitignored, may be absent)
log_level: debug
db:
  host: localhost
```

```sh
export MYAPP_DB__PORT=15432     # "__" becomes ":" → db:port
```

```go
cfg, err := sconf.Load[Config](
	sconf.New().
		AddYAMLFile("appsettings.yaml").
		AddYAMLFile("appsettings.local.yaml", sconf.Optional()). // no error if missing
		AddEnvironmentVariables("MYAPP_"),
	[]string{"--log_level", "warn"}, // pretend CLI args; normally os.Args[1:]
)
```

Result — each key resolved independently:

| Key | Value | Came from |
|---|---|---|
| `listen` | `:8080` | base file (nobody overrode it) |
| `log_level` | `warn` | CLI (beats local file's `debug`) |
| `db:host` | `localhost` | local file (beats base) |
| `db:port` | `15432` | env (beats base) |

## 3. Every file provider

```go
sconf.New().
	AddJSONFile("appsettings.json").
	AddYAMLFile("appsettings.yaml").
	AddTOMLFile("appsettings.toml").
	AddDotEnvFile(".env", "MYAPP_").          // .env file; prefix works like AddEnvironmentVariables
	AddInMemory(map[string]string{             // flat pairs, handy in tests
		"feature:beta": "true",
	})
```

File options compose:

```go
// Missing file is fine (local overrides, optional secrets):
AddYAMLFile("appsettings.local.yaml", sconf.Optional())

// Wait for a file to appear (sidecar drops secrets a moment after start):
AddTOMLFile("/vault/secrets/db.toml", sconf.Optional(), sconf.Wait(5*time.Second))
```

## 4. Environment variables: nesting, slices, prefix

`AddEnvironmentVariables(prefix)` reads every variable with the prefix; `__` maps to the `:` separator. See [Environment Variables](./environment-variables.md).

```sh
export MYAPP_LISTEN=":9090"                    # listen
export MYAPP_DB__HOST=localhost                # db:host
export MYAPP_SERVERS__0__HOST=a.internal       # servers:0:host  (slice index)
export MYAPP_SERVERS__1__HOST=b.internal       # servers:1:host
export MYAPP_FEATURES__BETA_SEARCH=true        # features:beta_search (map key)
```

```go
type Config struct {
	Listen  string `yaml:"listen"`
	DB      struct{ Host string } `yaml:"db"`
	Servers []struct{ Host string } `yaml:"servers"`
	Features map[string]bool `yaml:"features"`
}
// Servers == [{a.internal} {b.internal}], Features == {"beta_search": true}
```

### Pin one field to an exact variable name: the `env` tag

```go
type Config struct {
	DB struct {
		Host string `env:"DB_HOST"` // reads DB_HOST as-is, no prefix, no __
	}
}
```

`DB_HOST=prod-db` fills `cfg.DB.Host` even without any `AddEnvironmentVariables`. Priority: builder providers < `env` tag < CLI args.

## 5. Command line

All of these are equivalent (`__` becomes `:` in keys):

```sh
myapp --db:host=localhost
myapp --db:host localhost
myapp --db__host=localhost
myapp -db:host=localhost
myapp /db:host localhost
```

Pass `os.Args[1:]` as the second argument of `Load` — it becomes the top layer. Pass `nil` to disable CLI parsing and the `--help` check entirely.

## 6. Tags: `default`, `enum`, descriptions

```go
type Config struct {
	Host    string        `default:"0.0.0.0" description:"listen host"`
	Port    int           `default:"8080" usage:"listen port"`
	Mode    string        `enum:"dev,prod" default:"dev" description:"run mode"`
	Timeout time.Duration `default:"15s"`
}
```

- With an empty configuration the struct comes back `{0.0.0.0 8080 dev 15s}`.
- `mode: staging` anywhere → `config: "Mode" = "staging": config: value not allowed (allowed: dev, prod)` (matches case-insensitively; the bound value is canonicalized, so `PROD` binds as `prod`).
- The same tags drive `--help` output — see [Usage and Help](./usage-help.md).

## 7. Binding shapes

Everything a struct can hold, in one config. See [Struct Binding](./binding.md).

```yaml
name: worker
started: 2026-01-15T10:00:00Z     # time.Time (RFC3339 and a few friendly layouts)
poll: 250ms                        # time.Duration
replicas: 3
ratio: 0.75
verbose: true
tags: [a, b, c]                    # slice of scalars
servers:                           # slice of structs
  - host: a.internal
    port: 8001
  - host: b.internal
    port: 8002
limits:                            # map of scalars
  cpu: "2"
  mem: "512"
databases:                         # map of structs
  main:
    dsn: postgres://main
  audit:
    dsn: postgres://audit
```

```go
type Config struct {
	Name     string
	Started  time.Time
	Poll     time.Duration
	Replicas int
	Ratio    float64
	Verbose  bool
	Tags     []string
	Servers  []struct {
		Host string
		Port int
	}
	Limits    map[string]string
	Databases map[string]struct{ DSN string `yaml:"dsn"` }
	Optional  *struct{ X string } // pointer: stays nil when the section is absent
}
```

### A custom scalar type: `Unmarshaler`

```go
type CSV struct{ Items []string }

func (c *CSV) UnmarshalConfig(value string) error {
	c.Items = strings.Split(value, ",")
	return nil
}

type Config struct {
	Regions CSV `yaml:"regions"` // yaml: regions: eu-1,eu-2,us-1
}
```

### Self-validation: `Validator`

```go
type Encoder struct {
	Codec   string `enum:"h264,av1"`
	Threads int    `default:"2"`
}

func (e *Encoder) Validate() error {
	if e.Codec == "av1" && e.Threads < 4 {
		return fmt.Errorf("av1 requires at least 4 threads, got %d", e.Threads)
	}
	return nil
}
// on violation Load returns: config: validate "encoder": av1 requires at least 4 threads, got 2
```

## 8. Ad-hoc access without a struct

```go
cfg, err := sconf.New().AddYAMLFile("appsettings.yaml").Build()
if err != nil { log.Fatal(err) }

cfg.GetString("db:host")            // "" when absent
cfg.GetInt("db:port", 5432)         // fallback when absent or non-numeric
cfg.GetBool("db:ssl", false)
cfg.Exists("db")                    // true — value OR section
cfg.GetChildren("db")               // ["host", "port", "ssl"]

db := cfg.Section("db")             // scoped view
db.GetString("host")                // same as cfg.GetString("db:host")
```

## 9. `--help` in all its forms

With the `Config` from example 6, `myapp --help` prints and **exits with code 0** — you write no handling code:

```txt
Options:
  --Host     string  (default "0.0.0.0")  listen host
  --Port     int  (default "8080")  listen port
  --Mode     string  {dev|prod}  (default "dev")  run mode
  --Timeout  duration  (default "15s")

Built-in flags:
  --help, -h, -?                     print this help and exit
  --format table|env|json|yaml|toml  help output format (use with --help)
```

Machine-readable variants:

```sh
myapp --help --format env      # ready-to-fill .env template
myapp --help --format json     # schema: key/env/type/default/enum/description
```

The same schema over HTTP (no values, only the schema):

```go
mux.Handle("/config/usage", sconf.UsageHandler[Config]("MYAPP_"))
```

```sh
curl localhost:8080/config/usage?format=env
```

Programmatic access:

```go
fmt.Print(sconf.Usage[Config]())                  // the table as a string
out, _ := sconf.UsageFormat[Config]("env", "MYAPP_")
for _, e := range sconf.Describe[Config]() {      // structured entries
	fmt.Println(e.Key, e.Type, e.Default, e.Enum)
}
```

## 10. Dump: what did the service actually load?

`Dump` prints the **merged** configuration — invaluable when five layers disagree. See [Advanced](./advanced.md).

```go
cfg, _ := builder.Build()
out, _ := sconf.Dump[Config](cfg, sconf.DumpYAML,
	sconf.WithDumpRedact("db:password", "api_key"), // mask secrets: value → "***"
)
fmt.Print(out)
```

Formats: `DumpKeys` (flat `key = value` with `#` descriptions), `DumpEnv` (env-file form, `WithDumpEnvPrefix("MYAPP_")`), `DumpJSON`, `DumpYAML`, `DumpTOML`. `DumpValues` does the same without a struct type (no descriptions).

::: warning
Secret *paths* are safe to dump, but the `AddVaultKV` layer and [inline secret values](#13-secrets-without-vault-inline-values) put real secrets into the configuration — always `WithDumpRedact` those keys.
:::

## 11. Vault secrets, end to end

Declare fields, put paths in the config, done — resolution and background refresh are automatic. See [Vault Secrets](./vault.md).

```go
type Config struct {
	Service string          `yaml:"service"`
	DB      secret.UserPass `yaml:"db"`         // dynamic database creds
	AD      secret.UserPass `yaml:"ad"`         // AD: current_password picked automatically
	Stripe  secret.Value    `yaml:"stripe_key"` // one field of a KV secret
	Extra   secret.KV       `yaml:"extra"`      // the whole KV secret
	TLS     secret.Cert     `yaml:"tls"`        // pki-issued certificate
}
```

```yaml
service: billing
db:         database/creds/billing
ad:         ad/static-cred/svc
stripe_key: secret/data/billing?field=stripe_key
extra:      secret/data/billing
tls:        pki/issue/internal?common_name=billing.internal&ttl=24h&refresh=12h
```

```sh
# Kubernetes-style environment; see the full variable table in Vault Secrets
export VAULT_ADDR=https://vault.internal:8200
export VAULT_AUTH=kubernetes
export VAULT_K8S_ROLE=billing-api
```

```go
cfg, err := sconf.Load[Config](
	sconf.New().AddYAMLFile("appsettings.yaml"),
	os.Args[1:],
	sconf.WithVaultWait(30*time.Second), // ride out a slow istio sidecar at startup
	sconf.WithSecretErrorHandler(func(err error) {
		log.Println("vault refresh:", err) // background refresh failures (default: silent)
	}),
)
if err != nil { log.Fatal(err) }

cfg.DB.Username()      // always read through the methods — values rotate in the background
cfg.Stripe.Get()
cfg.Extra.Get("region")
cfg.TLS.Certificate()
```

### Reading credentials from one text field of a KV secret

When a team stores several credentials as JSON/YAML/TOML blobs inside one KV secret:

```yaml
redis: A/APP/OSH/KV/secrets?field=redis
```

```json
// the "redis" field inside the KV secret (JSON, YAML and TOML all work):
{"username": "redis-svc", "password": "redis-pw"}
```

`cfg.Redis.Username()` / `.Password()` — parsed automatically, refreshed like any other secret.

## 12. Local development without Vault: the secrets file

Put a `vault.secrets` file in the working directory (or point `VAULT_SECRETS_FILE` anywhere) and secrets are served from it — no server, no `VAULT_ADDR`, no auth:

```yaml
# vault.secrets — same paths as the config, fields as Vault would return them
database/creds/billing:
  username: devuser
  password: devpass
secret/data/billing:
  stripe_key: sk_test_local
  region: eu-central-1
pki/issue/internal:
  certificate: DEVCERT
  private_key: DEVKEY
  serial_number: dev-01
```

The file is re-read on every refresh (edits show up live) and beats `VAULT_ADDR` when both are set. A fully commented reference for every secret type ships in the repository as [`vault.secrets.example`](https://github.com/dvislobokov/sconf/blob/main/vault.secrets.example).

## 13. Secrets without Vault: inline values

The secret's fields can live right in the configuration — natural for `appsettings.local.yaml`:

```yaml
db:                      # secret.UserPass — a nested section instead of a path
  username: devuser
  password: devpass
stripe_key:              # secret.Value — a single "value" key
  value: sk_test_local
extra:                   # secret.KV
  region: local
tls:                     # secret.Cert
  certificate: DEVCERT
  private_key: DEVKEY
```

The section **wins over a path** set by an earlier layer — the base config keeps its production Vault paths, the local file replaces them with values, and Vault is never dialed. Individual fields can come from different layers (only the password from an env variable, say).

For one-liners (a single env variable, a CLI argument) use the `plain:` prefix:

```sh
MYAPP_DB='plain:{"username": "devuser", "password": "devpass"}'
MYAPP_STRIPE_KEY=plain:sk_test_local
```

## 14. Passing secrets around without losing rotation

The background refresher swaps the value inside the same secret object — so pass a **pointer to the field** and read at the moment of use, never copy the strings at startup:

```go
type Repo struct{ creds *secret.UserPass }

func NewRepo(creds *secret.UserPass) *Repo { return &Repo{creds: creds} }

func (r *Repo) connect(ctx context.Context) (*sql.DB, error) {
	// read HERE, per connection attempt — new connections get post-rotation creds
	dsn := fmt.Sprintf("postgres://%s:%s@db:5432/app",
		r.creds.Username(), r.creds.Password())
	return sql.Open("pgx", dsn)
}

repo := NewRepo(&cfg.DB) // ← pointer to the config field
```

Same idea for other clients:

```go
// HTTP: token per request, via a RoundTripper
type authRT struct{ token *secret.Value; base http.RoundTripper }

func (a authRT) RoundTrip(req *http.Request) (*http.Response, error) {
	req.Header.Set("Authorization", "Bearer "+a.token.Get())
	return a.base.RoundTrip(req)
}

// TLS: certificate per handshake — reissued pki certs picked up automatically
srv.TLSConfig = &tls.Config{
	GetCertificate: func(*tls.ClientHelloInfo) (*tls.Certificate, error) {
		c, err := tls.X509KeyPair(
			[]byte(cfg.TLS.Certificate()), []byte(cfg.TLS.PrivateKey()))
		return &c, err
	},
}
```

To keep lower layers free of sconf imports, accept a narrow interface — the secret pointer satisfies it:

```go
type Credentials interface {
	Username() string
	Password() string
}
func NewRepo(creds Credentials) *Repo { ... } // pass &cfg.DB
```

Never copy the struct (`u := cfg.DB` freezes the value and `go vet` flags it) and never stash `Password()` in a plain string field at startup.

## 15. A KV secret as a configuration layer

Secret *fields* fill one struct field each; `AddVaultKV` instead turns a KV secret's contents into ordinary configuration keys — bindable into plain fields, overridable by later layers:

```go
cfg, err := sconf.Load[Config](
	sconf.New().
		AddYAMLFile("appsettings.yaml").
		AddVaultKV("secret/data/myapp").            // fields land at the root
		AddVaultKVAt("secret/data/db", "database"). // fields land under database:
		AddEnvironmentVariables("MYAPP_"),          // env still beats the KV layer
	os.Args[1:],
)
```

Nested objects flatten like any source (`key:subkey`); the KV v2 envelope is unwrapped; the local secrets file works here too.

## 16. A custom provider

Any type with `Load() (map[string]string, error)` is a provider — keys use `:` for nesting:

```go
type ConsulProvider struct{ addr, prefix string }

func (p *ConsulProvider) Load() (map[string]string, error) {
	// fetch the KV subtree from Consul, flatten into {"db:host": "...", ...}
	return pairs, nil
}

cfg, err := sconf.Load[Config](
	sconf.New().
		AddYAMLFile("appsettings.yaml").
		Add(&ConsulProvider{addr: "consul:8500", prefix: "myapp/"}),
	os.Args[1:],
)
```

## 17. Lifecycle control: `LoadContext`

`Load` refreshes secrets for the life of the process. When you need a clean shutdown (tests, embedded usage), bound everything with a context:

```go
ctx, cancel := context.WithCancel(context.Background())
defer cancel() // stops the background secret refresh goroutines

cfg, err := sconf.LoadContext[Config](ctx, builder, os.Args[1:],
	sconf.WithSecretRetryBackoff(15*time.Second), // pause after a failed refresh (default 30s)
	sconf.WithSecretErrorHandler(func(err error) { log.Println("refresh:", err) }),
)
```

## 18. Error handling, all the cases

```go
cfg, err := sconf.Load[Config](builder, os.Args[1:])
// (--help never reaches here: Load prints usage and exits itself)
switch {
case errors.Is(err, sconf.ErrBindType):
	// config: cannot bind "Port" (value "eighty") to int: ...
case errors.Is(err, sconf.ErrEnum):
	// config: "Mode" = "staging": ... (allowed: dev, prod)
case errors.Is(err, sconf.ErrVaultNotConfigured):
	// secret fields exist but no VAULT_ADDR / auth in the environment
case err != nil:
	// I/O, parse, validator, Vault errors — the message names file/key/path
	log.Fatal(err)
}
```

See [Error Handling](./errors.md) for the full anatomy of each message.
