# Quick Start

This page configures a small image-processing service ("pixelmill") end to end: a YAML settings file, environment-variable overrides, command-line overrides, defaults, enum validation, and auto-generated help.

## 1. Install

```sh
go get github.com/dvislobokov/sconf
```

## 2. Declare the configuration struct

Key names come from the `yaml` tag (or `json` / `toml` / `name` — see [Struct binding](./binding.md)). `default` supplies a fallback, `enum` restricts allowed values, and `description` feeds the generated `--help`.

```go
type Config struct {
	Listen   string `yaml:"listen" default:"0.0.0.0:8080" description:"HTTP listen address"`
	LogLevel string `yaml:"log_level" enum:"debug,info,warn,error" default:"info" description:"log verbosity"`
	Workers  int    `yaml:"workers" default:"4" description:"parallel image workers"`

	Limits struct {
		MaxUploadMB    int           `yaml:"max_upload_mb" default:"32" description:"upload size cap"`
		ProcessTimeout time.Duration `yaml:"process_timeout" default:"30s" description:"per-image deadline"`
	} `yaml:"limits"`

	Formats []string `yaml:"formats" description:"output formats to enable"`
}
```

## 3. Write the settings file

```yaml
# appsettings.yaml
listen: 127.0.0.1:9000
log_level: debug
workers: 8
limits:
  max_upload_mb: 64
  process_timeout: 45s
formats:
  - jpeg
  - png
  - webp
```

## 4. Load

`sconf.Load[T]` is the single entry point. It checks for a help flag, appends the command-line arguments as the highest-priority layer, builds the merged configuration, and binds it into a fresh `*T`.

```go
func main() {
	cfg, err := sconf.Load[Config](
		sconf.New().
			AddYAMLFile("appsettings.yaml", sconf.Optional()).
			AddEnvironmentVariables("PIXELMILL_"),
		os.Args[1:],
	)
	// on --help, Load prints usage and exits the process itself
	if err != nil {
		log.Fatal(err)
	}

	fmt.Printf("listen=%s log_level=%s workers=%d\n", cfg.Listen, cfg.LogLevel, cfg.Workers)
	fmt.Printf("limits: upload=%dMB timeout=%s\n", cfg.Limits.MaxUploadMB, cfg.Limits.ProcessTimeout)
	fmt.Printf("formats: %v\n", cfg.Formats)
}
```

::: tip
`sconf.Optional()` makes the YAML file non-mandatory: if it is missing, the layer simply contributes nothing and the struct-tag defaults take over. Pass `nil` instead of `os.Args[1:]` to disable command-line handling entirely (no CLI layer, no `--help` check).
:::

## 5. Run

With just the file:

```sh
go run .
```

```txt
listen=127.0.0.1:9000 log_level=debug workers=8
limits: upload=64MB timeout=45s
formats: [jpeg png webp]
```

Now override one value from the environment and one from the command line. Environment variables use the configured prefix and `__` for nesting; command-line flags accept either `:` or `__` as the separator:

```sh
PIXELMILL_WORKERS=16 PIXELMILL_LOG_LEVEL=warn go run . --limits__process_timeout=20s
```

```txt
listen=127.0.0.1:9000 log_level=warn workers=16
limits: upload=64MB timeout=20s
formats: [jpeg png webp]
```

Per-key precedence at work: only the overridden keys changed; the rest still comes from the file.

## 6. Free help output

Because the struct carries `default`, `enum`, and `description` tags, `--help` costs nothing:

```sh
go run . --help
```

```txt
Options:
  --listen                  string  (default "0.0.0.0:8080")  HTTP listen address
  --log_level               string  {debug|info|warn|error}  (default "info")  log verbosity
  --workers                 int  (default "4")  parallel image workers
  --limits:max_upload_mb    int  (default "32")  upload size cap
  --limits:process_timeout  duration  (default "30s")  per-image deadline
  --formats                 []string  output formats to enable
```

## Next steps

- All sources and precedence rules: [Providers and layering](./providers.md)
- Everything the binder supports: [Struct binding](./binding.md)
- Secrets from Vault: [Vault secrets](./vault.md)
