# Configuration Layers

The feature cobra users assemble by hand with viper is one option in scmd: pass an [sconf](/sconf/) configuration and every flag becomes the top layer of a resolution chain.

## The resolution order

For each flag, the first source that has a value wins:

1. **argv** — the flag on the command line;
2. **env** — the variable named by the `env:"..."` tag, if present in the process environment;
3. **sconf** — the key from the `conf:"..."` tag (or the flag name), looked up in the configuration passed via `WithConfiguration`;
4. **default** — the `default:"..."` tag;
5. otherwise the field stays zero — or a usage error if `required:"true"`.

```go
cfg, err := sconf.New().
	AddJSONFile("appsettings.json", sconf.Optional()).
	AddDotEnvFile(".env", "APP_", sconf.Optional()).
	AddEnvironmentVariables("APP_").
	Build()

app := scmd.New("depl", "Deploy utility",
	scmd.WithConfiguration(cfg),
	scmd.Cmd("serve", "Run the server", runServe),
)
```

Note that sconf itself is layered — files, env prefixes, Vault, in-memory — so the full chain is `flag > env tag > (sconf: env prefix > file > ...) > default`, all declared once.

## Keys: the `conf` tag

The sconf key defaults to the flag name; use `conf:"..."` for hierarchical keys, with dots for sections:

```go
Port int `flag:"port" conf:"server.port"`   // looks up "server:port"
```

## Lists and maps from configuration

sconf flattens YAML arrays into `key:0`, `key:1`, ... and maps into `key:name`. scmd reassembles them into slice and map flags — array indices are ordered numerically (`2` before `10`):

```yaml
# appsettings.yaml
proto_paths: [proto, third_party]
labels:
  team: core
  tier: "1"
```

```go
Paths  []string          `flag:"proto_path" conf:"proto_paths"`
Labels map[string]string `flag:"label" conf:"labels"`
```

An explicit `--proto_path x` on the command line replaces the whole configured list.

## `scmd.Value[T]`: knowing where a value came from

Sometimes layering is not what you want — [protogen](/protogen/) merges its `protogenall.yaml` manually because the file is discovered *after* argument parsing (its location depends on a positional argument). What it still needs is cobra's `flag.Changed`: did the user type this flag, or is it a default?

`scmd.Value[T]` wraps a scalar field and records its origin:

```go
type Options struct {
	Out scmd.Value[string] `flag:"out" default:"gen"`
}

func run(ctx context.Context, o Options) error {
	o.Out.Get()     // "gen" or the explicit value
	o.Out.IsSet()   // false for the default, true for argv/env/sconf
	o.Out.Source()  // scmd.SourceArgv | SourceEnv | SourceConf | SourceDefault | SourceNone
	// explicit flags override the config file; defaults do not:
	if !o.Out.IsSet() && fileCfg.Out != "" { out = fileCfg.Out }
	return nil
}
```

`Value[T]` works for positional arguments too, and its element type drives parsing exactly like a plain field (`Value[bool]` flags are bare, `Value[int]` parses integers, ...). Slices and maps are not wrapped — for them, emptiness is the "unset" signal.
