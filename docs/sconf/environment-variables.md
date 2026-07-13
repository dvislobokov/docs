# Environment Variables

The environment provider maps variables onto the flat configuration model using the same convention as `Microsoft.Extensions.Configuration`: a configurable prefix plus `__` as the hierarchy separator. This makes even arrays of objects addressable from the environment.

## Prefix and the `__` convention

```go
sconf.New().AddEnvironmentVariables("MESHGATE_")
```

For every environment variable:

1. If a prefix is configured and the variable does not start with it, the variable is skipped. Otherwise the prefix is stripped.
2. Every `__` in the remaining name becomes `:`.
3. The result is a flat key, matched case-insensitively against your struct.

| Environment variable | Flat key |
|---|---|
| `MESHGATE_LISTEN` | `listen` |
| `MESHGATE_LIMITS__MAX_UPLOAD_MB` | `limits:max_upload_mb` |
| `MESHGATE_SENSORS__0__INTERVAL` | `sensors:0:interval` |

::: warning
An empty prefix (`AddEnvironmentVariables("")`) imports the *entire* environment into the configuration tree. That works, but a unique prefix per application avoids accidental collisions with unrelated variables like `PATH` or `HOME`.
:::

## Arrays of objects from the environment

Because array elements are just keys with numeric segments (`sensors:0:kind`), an entire slice of structs can be described — or extended, or partially overridden — with environment variables. This works uniformly with the other layers.

The verified example is an IoT collector:

```go
type Sensor struct {
	ID       string        `yaml:"id"`
	Kind     string        `yaml:"kind" enum:"temp,humidity,co2"`
	Interval time.Duration `yaml:"interval" default:"30s"`
}

type Uplink struct {
	URL    string `yaml:"url"`
	Weight int    `yaml:"weight" default:"1"`
}

type Config struct {
	Sensors []Sensor `yaml:"sensors"`
	Uplinks []Uplink `yaml:"uplinks"`
}
```

```yaml
# collector.yaml
sensors:
  - id: greenhouse-a
    kind: temp
    interval: 15s
  - id: greenhouse-b
    kind: humidity
```

With no environment set:

```txt
sensor[0]: id=greenhouse-a kind=temp interval=15s
sensor[1]: id=greenhouse-b kind=humidity interval=30s
```

Now three things at once from the environment — override **one field of one element**, append a **third element**, and build the `uplinks` array **entirely from env vars**:

```sh
MESHGATE_SENSORS__0__INTERVAL=5s \
MESHGATE_SENSORS__2__ID=rooftop \
MESHGATE_SENSORS__2__KIND=co2 \
MESHGATE_UPLINKS__0__URL=https://ingest.example/a \
MESHGATE_UPLINKS__1__URL=https://ingest.example/b \
MESHGATE_UPLINKS__1__WEIGHT=3 \
go run .
```

```txt
sensor[0]: id=greenhouse-a kind=temp interval=5s
sensor[1]: id=greenhouse-b kind=humidity interval=30s
sensor[2]: id=rooftop kind=co2 interval=30s
uplink[0]: url=https://ingest.example/a weight=1
uplink[1]: url=https://ingest.example/b weight=3
```

Note what happened per key:

- `sensors:0:interval` was replaced; `sensors:0:id` and `sensors:0:kind` still come from YAML — the merge is per key, not per element.
- Index `2` did not exist in YAML; providing its keys grew the slice.
- Missing fields (`sensors:2:interval`, `uplinks:0:weight`) fell back to struct-tag defaults.

::: tip
Slice indices do not need to be contiguous. The binder collects the numeric child segments, sorts them ascending, and collapses holes — indices `0`, `3`, `7` produce a 3-element slice in that order.
:::

## Interaction with other layers

The environment layer participates in normal precedence: it overrides whatever was added before it (typically files) and is overridden by whatever comes after (typically the command line). A common production setup:

```go
cfg, err := sconf.Load[Config](
	sconf.New().
		AddYAMLFile("collector.yaml").
		AddEnvironmentVariables("MESHGATE_"),
	os.Args[1:],
)
```

## Case sensitivity and naming

- Configuration keys are case-insensitive, so `MESHGATE_SENSORS__0__ID` matches a field tagged `yaml:"id"` inside `Sensors`.
- Underscores that are *not* doubled are kept as-is: `MESHGATE_LOG_LEVEL` maps to the key `log_level`, matching a field tagged `yaml:"log_level"`.
- The provider reads `os.Environ()` at `Build`/`Load` time; changes made with `os.Setenv` before loading are visible.
