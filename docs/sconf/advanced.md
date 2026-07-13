# Advanced

This page covers the extension points: custom value parsing with `Unmarshaler`, self-validation with `Validator`, ad-hoc access to the merged tree without a struct, and writing your own provider. All examples come from one verified program — a video-transcoding farm.

## Custom parsing with `Unmarshaler`

A type that implements `sconf.Unmarshaler` (alias of `bind.Unmarshaler`) parses its own string representation. It takes priority over reflection, and it also receives the `default` tag value when no source supplies the key.

```go
type Unmarshaler interface {
	UnmarshalConfig(value string) error
}
```

A human-friendly byte size:

```go
// ByteSize parses human-friendly sizes ("512KB", "8MB") via the Unmarshaler hook.
type ByteSize int64

func (b *ByteSize) UnmarshalConfig(value string) error {
	s := strings.ToUpper(strings.TrimSpace(value))
	mult := int64(1)
	switch {
	case strings.HasSuffix(s, "GB"):
		mult, s = 1<<30, strings.TrimSuffix(s, "GB")
	case strings.HasSuffix(s, "MB"):
		mult, s = 1<<20, strings.TrimSuffix(s, "MB")
	case strings.HasSuffix(s, "KB"):
		mult, s = 1<<10, strings.TrimSuffix(s, "KB")
	}
	n, err := strconv.ParseInt(strings.TrimSpace(s), 10, 64)
	if err != nil {
		return fmt.Errorf("invalid size %q: %w", value, err)
	}
	*b = ByteSize(n * mult)
	return nil
}
```

```go
type Config struct {
	ChunkSize ByteSize `yaml:"chunk_size" default:"8MB"`
	Encoder   Encoder  `yaml:"encoder"`
}
```

With `chunk_size: 64MB` in YAML the program prints `chunk=67108864 bytes`. If `UnmarshalConfig` returns an error, it is wrapped into an `ErrBindType` error with the key path and raw value.

::: info
The method must have a pointer receiver, and the binder checks the hook on the *addressable* field — which is always the case inside the `*T` that `Load` allocates. The secret types in `sconf/secret` use exactly this hook to capture Vault paths.
:::

## Self-validation with `Validator`

After a value (struct, slice, map, or scalar) is bound, the binder calls `Validate()` if the value's pointer implements `sconf.Validator`:

```go
// Encoder validates itself after binding via the Validator hook.
type Encoder struct {
	Codec   string `yaml:"codec" enum:"h264,h265,av1"`
	Threads int    `yaml:"threads" default:"2"`
}

func (e *Encoder) Validate() error {
	if e.Codec == "av1" && e.Threads < 4 {
		return fmt.Errorf("av1 requires at least 4 threads, got %d", e.Threads)
	}
	return nil
}
```

A violation surfaces from `Load` as:

```txt
config: validate "encoder": av1 requires at least 4 threads, got 2
```

Validation is per-node and bottom-up along the traversal, so a nested section can enforce its own invariants without knowing about the rest of the configuration.

## Ad-hoc access: `Config`, `Section`, `GetChildren`

You do not have to bind a struct. `Builder.Build()` returns the merged `*sconf.Config`, which is safe for concurrent reads and case-insensitive:

```go
raw, err := sconf.New().
	AddYAMLFile("farm.yaml").
	Add(dotenvProvider{path: "overrides.env"}).
	Build()
if err != nil {
	log.Fatal(err)
}
fmt.Printf("encoder exists: %t, threads: %d\n",
	raw.Exists("encoder"), raw.GetInt("encoder:threads", 1))

enc := raw.Section("encoder")
fmt.Printf("section codec=%s children=%v\n",
	enc.GetString("codec"), raw.GetChildren("encoder"))
```

```txt
encoder exists: true, threads: 2
section codec=h264 children=[codec threads]
```

| Method | Behavior |
|---|---|
| `Get(key) (string, bool)` | Raw string value and presence flag. Keys are hierarchical (`encoder:codec`). |
| `GetString(key) string` | Value or `""`. |
| `GetInt(key, def) int` / `GetBool(key, def) bool` | Parsed value, or `def` when the key is missing *or* unparsable. |
| `Exists(key) bool` | True for a value **or** a non-empty nested section. |
| `Section(key) *Config` | A view restricted to the key prefix. It shares the underlying data with the parent — no copying. |
| `GetChildren(key) []string` | Immediate child segment names, normalized (lower case) and sorted. Empty `key` lists children of the current section. |

## Writing a custom provider

A provider only needs `Load() (map[string]string, error)` returning flat pairs (use `:` as the separator, or apply the `__` convention yourself). Here is a complete dotenv-style provider:

```go
// dotenvProvider is a custom sconf.Provider: it reads KEY=VALUE lines from a
// file and applies the usual "__" -> ":" convention.
type dotenvProvider struct{ path string }

func (p dotenvProvider) Load() (map[string]string, error) {
	f, err := os.Open(p.path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	out := map[string]string{}
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		out[strings.ReplaceAll(k, "__", ":")] = v
	}
	return out, sc.Err()
}
```

Plugged in with `Add`, it participates in layering like any built-in source:

```go
builder := sconf.New().
	AddYAMLFile("farm.yaml").
	Add(dotenvProvider{path: "overrides.env"})
```

With `farm.yaml` declaring `codec: h264, threads: 2` and `overrides.env` containing:

```txt
# local overrides, dotenv style
encoder__codec=av1
encoder__threads=8
```

the merged result (dotenv layer wins) is:

```txt
chunk=67108864 bytes codec=av1 threads=8
```

Guidelines for provider authors:

- Return an error to abort the whole `Build`/`Load`; return an empty map for "nothing to contribute".
- Keys may be emitted in any case — the merged map normalizes to lower case and remembers the original spelling for error messages.
- `Load` is called once per `Build`. If your source is expensive (network), consider caching inside the provider.

## Adding a custom secret type

Since v1.1.0 the Vault resolver is built into the core — `RegisterSecretResolver` and the `SecretResolver` interface are gone. To extend the secrets machinery, implement `secret.Resolvable` (and optionally `secret.Refreshable`) on your own field type: `sconf.Load` discovers such fields automatically after binding and fills them through the built-in Vault client, including background refresh. See [Vault secrets](./vault.md).
