# Configuration

Every construction option has a declarative counterpart: the `Config` struct decodes from JSON (the struct also carries `yaml` tags, so it decodes with `gopkg.in/yaml.v3` without srog depending on a YAML parser) and builds the same logger the functional options would.

## Loading

```go
log, err := srog.NewFromConfigFile("logging.json") // open + decode + build
// or step by step:
cfg, err := srog.LoadConfigFile("logging.json")    // Config from a file path
cfg, err := srog.LoadConfig(reader)                // Config from any io.Reader
log, err := cfg.Build()                            // Config -> *Logger
log, err := srog.NewFromConfig(cfg)                // shorthand for cfg.Build()
```

## Full schema

Documented from the parser (`Config`, `SinkSpec`, `RotationSpec`). All fields are optional unless noted; an empty/zero field leaves the corresponding option at its default.

### Top level

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `level` | string | `"information"` | Default minimum level: `verbose`/`trace`, `debug`, `information`/`info`, `warning`/`warn`, `error`, `fatal` (case-insensitive) |
| `render` | bool | `true` | Render the human-readable `message` field. Explicit `false` disables it |
| `caller` | bool | `false` | Annotate events with `file:line` of the call site |
| `timestamp` | bool | `true` | Add a timestamp to each event. Explicit `false` disables it |
| `stackTrace` | bool | `false` | Capture a stack when an error is logged |
| `timeFormat` | string | RFC 3339 | Friendly name (`rfc3339`, `rfc3339nano`, `datetime`, `dateonly`, `timeonly`, `kitchen`, `unix`, `unixms`, `unixmicro`, `unixnano`) or a raw Go time layout |
| `sinks` | array of sink | JSON to stdout | Output destinations |

### Sink object

| Key | Type | Applies to | Meaning |
| --- | --- | --- | --- |
| `type` | string | required | `"console"`, `"file"`, `"stdout"`, `"stderr"`, or any name registered via [`RegisterSinkType`](#registered-sink-types) (e.g. `"otlp"` once `srog/srogotel` is imported) |
| `target` | string | `console` | Stream for a console sink: `"stdout"` (default) or `"stderr"` |
| `path` | string | `file` (required) | File path; the parent directory must exist |
| `level` | string | all | Per-sink minimum level (same names as `level`) |
| `format` | string | all | `"json"`, `"console"` (alias `"text"`), `"ecs"`, or `"otel"` (aliases `"opentelemetry"`, `"otlp"`) |
| `noColor` | bool | console format | Disable ANSI colors |
| `rotation` | object | `file` | Rotation and retention (below) |
| `options` | object | registered types | Type-specific settings for sinks registered via `RegisterSinkType`; built-in types ignore it |

Sink type defaults: `console` formats as console; `file`, `stdout`, and `stderr` format as JSON unless `format` says otherwise.

### Rotation object

| Key | Type | Meaning |
| --- | --- | --- |
| `maxSizeMB` | int | Rotate once the file exceeds this many megabytes |
| `maxBackups` | int | Keep at most this many rotated files (0 = all) |
| `maxAgeDays` | int | Delete rotated files older than this many days |
| `compress` | bool | Gzip rotated files |
| `localTime` | bool | Local time for backup names and boundaries (default UTC) |
| `every` | string | `""`/`"none"`, `"hourly"`, or `"daily"` |

Unknown level, format, or interval names produce a descriptive error (e.g. `srog: sinks[1]: unknown format "xml" (want json, console, ecs, or otel)`). A sink `type` that is neither built-in nor registered errors as well.

## Registered sink types

Since v1.1.0 the set of sink types is extensible: a module can register a new type name with `RegisterSinkType`, and config files can then use it like any built-in. This is the serializable counterpart of `WithWriter` — custom destinations become expressible in JSON/YAML.

```go
// SinkFactory builds the destination writer for an externally registered sink
// type. The returned writer receives events serialized in format (unless the
// spec's own "format" overrides it); if it also implements io.Closer it is
// closed by Logger.Close.
type SinkFactory func(cfg Config, spec SinkSpec) (w io.Writer, format Format, err error)

func RegisterSinkType(name string, factory SinkFactory)

func (s SinkSpec) DecodeOptions(v any) error // decode spec.Options into a struct
```

Rules:

- Names are case-insensitive and trimmed; registering the same name again replaces the earlier factory. Registration is safe for concurrent use.
- The built-in names `console`, `file`, `stdout`, and `stderr` always win — they cannot be shadowed by a registration.
- The sink entry's own `level`, `format`, and `noColor` still apply on top: an explicit `format` overrides the factory's default.
- Type-specific settings travel in the entry's `options` object; the factory reads them with `spec.DecodeOptions(&myOptions)`.
- If the factory's writer implements `io.Closer`, `Logger.Close` closes it — this is how network sinks flush on shutdown.

Modules typically register in `init()`, so a blank import enables the type. The bundled example is the [`otlp` sink](./integrations.md#otlp-export-to-the-collector-srogotel) from `srog/srogotel`:

```go
import _ "github.com/dvislobokov/srog/srogotel" // registers the "otlp" sink type
```

```json
{
  "sinks": [
    { "type": "console" },
    {
      "type": "otlp",
      "level": "warning",
      "options": { "endpoint": "collector:4317", "insecure": true }
    }
  ]
}
```

Writing your own:

```go
srog.RegisterSinkType("mysink", func(cfg srog.Config, spec srog.SinkSpec) (io.Writer, srog.Format, error) {
	var o struct {
		URL string `json:"url"`
	}
	if err := spec.DecodeOptions(&o); err != nil {
		return nil, 0, err
	}
	w := newMyWriter(o.URL) // may implement io.Closer
	return w, srog.FormatJSON, nil
})
```

## A worked example

A greenhouse controller: debug console plus a rotated info-level file.

```json
{
  "level": "debug",
  "stackTrace": true,
  "timeFormat": "timeonly",
  "sinks": [
    { "type": "console", "level": "debug", "noColor": true },
    {
      "type": "file",
      "path": "greenhouse.log",
      "level": "information",
      "rotation": { "maxSizeMB": 50, "maxBackups": 5, "compress": true, "every": "daily" }
    }
  ]
}
```

```go
log, err := srog.NewFromConfigFile("logging.json")
if err != nil {
	panic(err)
}
log.Debug("sensor {SensorId} sampled {Celsius:.1f}C", "gh-t04", 23.84)
log.Information("vent {VentId} opened to {Percent} percent", "v2", 40)
log.Close()
```

Captured output — the Debug line reached only the console; the file received the info event with the `timeonly` timestamp:

::: code-group

```txt [Console]
11:55:41 DBG sensor gh-t04 sampled 23.8C
11:55:41 INF vent v2 opened to 40 percent
```

```json [greenhouse.log]
{"level":"info","@mt":"vent {VentId} opened to {Percent} percent","VentId":"v2","Percent":40,"time":"11:55:41","message":"vent v2 opened to 40 percent"}
```

:::

## Programmatic vs file configuration

The two styles are equivalent, and they compose: `Config.Options()` translates a config into the matching `[]Option` slice, to which you can append programmatic options (useful for options that have no serializable form, such as `WithErrorHandler` or `WithSampling`; custom writers can go either way — programmatically via `WithWriter`, or declaratively via a [registered sink type](#registered-sink-types)).

::: code-group

```go [Programmatic]
log, err := srog.New(
	srog.WithLevel(srog.DebugLevel),
	srog.WithStackTrace(true),
	srog.WithTimeFormat(srog.TimeOnly),
	srog.WithConsole(srog.MinLevel(srog.DebugLevel), srog.NoColor()),
	srog.WithFile("greenhouse.log",
		srog.MinLevel(srog.InformationLevel),
		srog.Rotate(srog.Rotation{MaxSizeMB: 50, MaxBackups: 5, Compress: true, Every: srog.Daily}),
	),
)
```

```go [Config file + extras]
cfg, err := srog.LoadConfigFile("logging.json")
if err != nil {
	return err
}
opts, err := cfg.Options()
if err != nil {
	return err
}
log, err := srog.New(append(opts,
	srog.WithErrorHandler(reportSinkFailure), // not expressible in JSON
)...)
```

:::
