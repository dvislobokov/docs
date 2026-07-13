# Sinks

A sink is one output destination with its own format and minimum level. A logger fans out to any number of sinks; this page covers the three sink constructors, the four formats, per-sink options, error handling, and async mode.

## Sink constructors

| Option | Destination | Default format |
| --- | --- | --- |
| `WithConsole(opts...)` | `os.Stdout` | `FormatConsole` (colorized, human-friendly) |
| `WithFile(path, opts...)` | file at `path` (appended, created if missing) | `FormatJSON` |
| `WithWriter(w, opts...)` | any `io.Writer` (`os.Stderr`, a buffer, a network sink, ...) | `FormatJSON` |

With no sink option at all, `New` defaults to a single JSON sink on `os.Stdout`.

::: warning
`WithFile` requires the parent directory to exist. If the file cannot be opened, `New` returns the error (and `MustNew` panics).
:::

## Formats

Each sink serializes independently. The four formats:

| Format | Sink option | Output |
| --- | --- | --- |
| `FormatJSON` | `AsJSON()` | Newline-delimited JSON — the machine form for Fluent Bit and friends |
| `FormatConsole` | `AsConsole()` | Colorized human lines: timestamp, level tag, message, error, caller. Structured fields are intentionally omitted |
| `FormatECS` | `AsECS()` | NDJSON with Elastic Common Schema field names (`@timestamp`, `log.level`, ...) |
| `FormatOTel` | `AsOTel()` | One OpenTelemetry OTLP/JSON `LogRecord` per line |

ECS and OTel output shapes are documented in [Integrations](./integrations.md).

## Per-sink options

| SinkOption | Effect |
| --- | --- |
| `MinLevel(l)` | Minimum level for this sink only (overrides `WithLevel`) |
| `AsJSON()` / `AsConsole()` / `AsECS()` / `AsOTel()` | Force the serialization format |
| `NoColor()` | Disable ANSI colors on a console sink |
| `Rotate(r)` | Enable rotation/retention on a file sink (see [Rotation](./rotation.md)) |
| `Async(bufferSize)` | Offload this sink's writes to a background goroutine |

## Multi-sink fan-out

Console for operators, JSON file for the shipper — each with its own threshold:

```go
dir, _ := os.MkdirTemp("", "srog-sinks")
logPath := filepath.Join(dir, "ci.log")

log, err := srog.New(
	srog.WithConsole(srog.NoColor(), srog.MinLevel(srog.DebugLevel)),
	srog.WithFile(logPath, srog.MinLevel(srog.InformationLevel)),
	srog.WithTimeFormat(srog.TimeUnixMs),
	srog.WithErrorHandler(func(err error) {
		fmt.Fprintln(os.Stderr, "sink failure:", err)
	}),
)
if err != nil {
	panic(err)
}

log.Debug("compiling {Package}", "internal/scheduler") // console only
log.Information("pipeline {PipelineId} passed in {Duration}", "pl-778", "3m41s")
log.Close()
```

Captured output — the Debug line reached only the console:

::: code-group

```txt [Console]
DBG compiling internal/scheduler
INF pipeline pl-778 passed in 3m41s
```

```json [File (ci.log)]
{"level":"info","@mt":"pipeline {PipelineId} passed in {Duration}","PipelineId":"pl-778","Duration":"3m41s","time":1783932941133,"message":"pipeline pl-778 passed in 3m41s"}
```

:::

Note the epoch-milliseconds `time` from `WithTimeFormat(srog.TimeUnixMs)`.

## Timestamp formats

`WithTimeFormat` sets the timestamp layout per logger — it never touches zerolog's process-wide global, so loggers with different formats coexist. Pass a Go layout or one of the exported constants:

| Constant | Output |
| --- | --- |
| `TimeRFC3339` (default) | `"2026-07-13T11:55:30+03:00"` |
| `TimeRFC3339Nano` | ISO 8601 with nanoseconds |
| `TimeDateTime` | `"2026-07-13 11:55:30"` |
| `TimeDateOnly` / `TimeOnly` / `TimeKitchen` | date only / time only / `3:04PM` |
| `TimeUnix` / `TimeUnixMs` / `TimeUnixMicro` / `TimeUnixNano` | epoch JSON numbers |

`WithTimestamp(false)` removes the timestamp entirely.

::: info
A custom time format is applied by a per-logger hook that runs at event-finalize time, so the `time` field appears after the message rather than before it — a cosmetic field-order difference only. Console sinks print the timestamp only for string layouts; epoch (numeric) formats are meant for machine sinks.
:::

## Write-error handling

zerolog silently drops sink write failures (full disk, broken pipe). `WithErrorHandler` installs a callback that receives them instead, so you can count, alert, or fall back:

```go
srog.WithErrorHandler(func(err error) { metrics.LogWriteErrors.Inc() })
```

The handler must be safe for concurrent use and must not log through the same logger.

## Async sinks

`Async(bufferSize)` decouples a sink from the request path: writes are copied into a bounded queue and drained by a background goroutine. If the queue fills, events are **dropped rather than blocking the caller**; the total drop count is reported through the error handler on `Close`. A non-positive size uses the default of 1024.

```go
alog := srog.MustNew(
	srog.WithFile(asyncPath, srog.Async(4096)),
	srog.WithTimestamp(false),
)
for i := 1; i <= 3; i++ {
	alog.Information("artifact {Index} uploaded", i)
}
alog.Close() // drains the queue before returning
```

Captured file contents after `Close` — all three queued events made it to disk:

```json
{"level":"info","@mt":"artifact {Index} uploaded","Index":1,"message":"artifact 1 uploaded"}
{"level":"info","@mt":"artifact {Index} uploaded","Index":2,"message":"artifact 2 uploaded"}
{"level":"info","@mt":"artifact {Index} uploaded","Index":3,"message":"artifact 3 uploaded"}
```

::: warning
Always `Close()` a logger with async sinks. Without it, queued events are lost on exit. `Fatal` flushes sinks itself before terminating.
:::

## Custom writer sinks

Any `io.Writer` can be a sink, which is how the [Elasticsearch sink](./integrations.md#elasticsearch-srogelastic) plugs in:

```go
var buf bytes.Buffer
log := srog.MustNew(srog.WithWriter(&buf))                 // JSON into a buffer
errLog := srog.MustNew(srog.WithWriter(os.Stderr, srog.AsConsole())) // console on stderr
```
