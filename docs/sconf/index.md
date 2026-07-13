# sconf

sconf is a layered configuration library for Go modeled after `Microsoft.Extensions.Configuration` from ASP.NET Core. Every source — files, environment variables, command line, in-memory maps, Vault — is reduced to one flat model (`path → string`, with `:` as the separator), merged in order, and bound uniformly into your structs.

## Why sconf

- **One flat model for every source.** A YAML tree, a JSON file, `MYAPP_SERVERS__0__HOST`, and `--servers:0:host` all become the same key `servers:0:host`. Because merging happens per key, any single value can be overridden by a higher layer — including a single field of a single array element.
- **Layering with per-key precedence.** Sources added later win, key by key, not file by file.
- **Arrays of objects from environment variables** using the `__` → `:` convention — a capability the flat model gives you for free (and one that viper's per-source merge model does not provide; viper cannot override one element of an array from an env var, since `BindEnv` operates on whole keys of unflattened trees).
- **Typed binding via generics.** One entry point, `sconf.Load[T]`, returns `*T` with defaults, enum validation, `time.Duration`/`time.Time` parsing, pointers, maps, slices, and embedded structs handled.
- **Auto-generated `--help`** from your struct tags, plus programmatic access via `Describe[T]`.
- **Secrets from HashiCorp Vault** built in: declare a field as `secret.UserPass`, `secret.Cert`, `secret.KV`, or `secret.Value`, keep only the *path* in your config file, and the values are fetched at load time and refreshed in the background automatically.
- **Operational niceties:** optional files, waiting for files to appear on disk (Vault sidecar / init containers), and typed sentinel errors.

## Installation

```sh
go get github.com/dvislobokov/sconf
```

Requires Go 1.24 or newer (v1.1.0+). The Vault integration is part of the core package — if your config has no secret fields, Vault is simply never contacted.

## A minimal example

```go
package main

import (
	"errors"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/dvislobokov/sconf"
)

type Config struct {
	Listen   string `yaml:"listen" default:"0.0.0.0:8080" description:"HTTP listen address"`
	LogLevel string `yaml:"log_level" enum:"debug,info,warn,error" default:"info"`
	Workers  int    `yaml:"workers" default:"4"`

	Limits struct {
		ProcessTimeout time.Duration `yaml:"process_timeout" default:"30s"`
	} `yaml:"limits"`
}

func main() {
	cfg, err := sconf.Load[Config](
		sconf.New().
			AddYAMLFile("appsettings.yaml", sconf.Optional()).
			AddEnvironmentVariables("PIXELMILL_"),
		os.Args[1:],
	)
	switch {
	case errors.Is(err, sconf.ErrHelp):
		os.Exit(0) // usage has already been printed
	case err != nil:
		log.Fatal(err)
	}

	fmt.Printf("listen=%s log_level=%s workers=%d\n", cfg.Listen, cfg.LogLevel, cfg.Workers)
}
```

Run it with an environment override and a command-line override:

```sh
PIXELMILL_WORKERS=16 ./pixelmill --limits__process_timeout=20s
```

```txt
listen=127.0.0.1:9000 log_level=debug workers=16
```

The value of `workers` came from the environment, `limits:process_timeout` from the command line, and everything else from `appsettings.yaml` — with struct-tag defaults filling any gaps.

## Package layout

| Package | Contents |
|---|---|
| `sconf` | `Builder`, `Config`, `Load[T]`, `Usage[T]`, sentinel errors, option re-exports |
| `sconf/provider` | `JSONFile`, `YAMLFile`, `TOMLFile`, `Env`, `Args`, `Map`, file options |
| `sconf/bind` | reflection binder, `Unmarshaler` / `Validator` hooks, `Describe` / `Usage` |
| `sconf/secret` | secret field types (`UserPass`, `Cert`, `KV`, `Value`) — standard library only |
| `sconf/internal/vault` | Vault client internals — used by the core, not imported directly |

## Where to go next

- [Quick start](./quick-start.md) — configure a complete small service end to end.
- [Providers and layering](./providers.md) — every source and the precedence rules.
- [Environment variables](./environment-variables.md) — the `__` convention and arrays of objects.
- [Struct binding](./binding.md) — supported types and tags.
- [Usage and help](./usage-help.md) — auto-generated `--help`.
- [Advanced](./advanced.md) — custom parsing, validation, ad-hoc access, custom providers.
- [Vault secrets](./vault.md) — secret fields, refresh, and local development.
- [Error handling](./errors.md) — the sentinel errors.
- [API reference](./api.md) — every exported symbol.

Source: [github.com/dvislobokov/sconf](https://github.com/dvislobokov/sconf)
