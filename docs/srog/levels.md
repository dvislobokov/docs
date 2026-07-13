# Levels

srog mirrors Serilog's severity ladder, mapped directly onto zerolog levels. This page covers the ladder, logger-wide and per-sink filtering, derived-logger levels, and `Fatal` semantics.

## The severity ladder

| srog level | Method | zerolog level | JSON `level` | Console tag |
| --- | --- | --- | --- | --- |
| `VerboseLevel` | `Verbose` | trace | `trace` | `TRC` |
| `DebugLevel` | `Debug` | debug | `debug` | `DBG` |
| `InformationLevel` | `Information` / `Info` | info | `info` | `INF` |
| `WarningLevel` | `Warning` | warn | `warn` | `WRN` |
| `ErrorLevel` | `Error` | error | `error` | `ERR` |
| `FatalLevel` | `Fatal` | fatal | `fatal` | `FTL` |

`Info` is a shorthand alias for `Information`. `Error` and `Fatal` take the triggering `error` as their first parameter; pass `nil` when there is none.

```go
func (l *Logger) Verbose(tmpl string, args ...any)
func (l *Logger) Debug(tmpl string, args ...any)
func (l *Logger) Information(tmpl string, args ...any)
func (l *Logger) Warning(tmpl string, args ...any)
func (l *Logger) Error(err error, tmpl string, args ...any)
func (l *Logger) Fatal(err error, tmpl string, args ...any)
```

::: warning Fatal terminates the process
`Fatal` logs the event, **flushes all sinks** (so the final event reaches file and async sinks), and then calls `os.Exit(1)`. Deferred functions do not run after `os.Exit`.
:::

## Logger-wide level

`WithLevel` sets the default minimum level. Events below it are rejected before anything is allocated. The default is `InformationLevel`.

```go
log := srog.MustNew(srog.WithConsole(), srog.WithLevel(srog.DebugLevel))
```

## Per-sink levels

`MinLevel` overrides the logger-wide level for one sink. This is what lets the console show `Debug` while a second sink keeps only `Warning` and above:

```go
var alerts bytes.Buffer
log := srog.MustNew(
	srog.WithConsole(srog.NoColor(), srog.MinLevel(srog.DebugLevel)),
	srog.WithWriter(&alerts, srog.MinLevel(srog.WarningLevel)),
	srog.WithTimestamp(false),
)

log.Verbose("polling job queue")                                     // below both sinks: dropped
log.Debug("runner {Runner} picked job {JobId}", "linux-large", 9313) // console only
log.Information("job {JobId} finished in {Seconds}s", 9313, 41)      // console only
log.Warning("cache miss rate {Rate:.0f} percent on {Runner}", 62.0, "linux-large")
log.Error(errors.New("exit status 2"), "job {JobId} failed at step {Step}", 9314, "test")
```

Captured output — the console sink saw four events, the warning sink two:

::: code-group

```txt [Console sink (Debug+)]
DBG runner linux-large picked job 9313
INF job 9313 finished in 41s
WRN cache miss rate 62 percent on linux-large
ERR job 9314 failed at step test exit status 2
```

```json [Buffer sink (Warning+)]
{"level":"warn","@mt":"cache miss rate {Rate:.0f} percent on {Runner}","Rate":62,"Runner":"linux-large","message":"cache miss rate 62 percent on linux-large"}
{"level":"error","error":"exit status 2","@mt":"job {JobId} failed at step {Step}","JobId":9314,"Step":"test","message":"job 9314 failed at step test"}
```

:::

Internally the logger's own threshold is set to the **lowest** effective sink level, and with multiple sinks each write is fanned out through a per-sink level filter.

## Child loggers with a different level

`Logger.WithLevel` derives a child logger with its own minimum level, leaving the parent unchanged. `Enabled` reports whether a level would be emitted — useful to guard expensive argument construction:

```go
quiet := log.WithLevel(srog.ErrorLevel)
quiet.Information("this is filtered out")

log.Enabled(srog.DebugLevel)   // true
quiet.Enabled(srog.DebugLevel) // false
```

```txt
parent Enabled(Debug): true
child  Enabled(Debug): false
```

::: info Dynamic levels
There is no runtime level *mutation* — loggers are immutable. To change verbosity at runtime, derive a child with `WithLevel` and swap it in (for the global logger, `srog.SetDefault` is atomic and safe under concurrency).
:::

## Parsing level names

`ParseLevel` resolves Serilog-style names, case-insensitively, including aliases:

| Input (any case) | Level |
| --- | --- |
| `verbose`, `trace` | `VerboseLevel` |
| `debug` | `DebugLevel` |
| `information`, `info` | `InformationLevel` |
| `warning`, `warn` | `WarningLevel` |
| `error` | `ErrorLevel` |
| `fatal` | `FatalLevel` |

```go
lvl, err := srog.ParseLevel("warning") // WarningLevel, nil
```

The same names are accepted by the `level` fields of the [JSON configuration](./configuration.md).

## Sampling

Orthogonal to level filtering, `WithSampling` applies flood control after the level check:

```go
// Emit at most 100 events per second from this logger; after that, 1 in 100.
log := srog.MustNew(
	srog.WithConsole(),
	srog.WithSampling(srog.BurstLimit(100, time.Second, srog.EveryN(100))),
)
```

- `EveryN(n)` emits one of every `n` events.
- `BurstLimit(burst, period, next)` emits up to `burst` events per `period`, then defers overflow to `next` (pass `nil` to drop everything past the burst).
- `Sampler` aliases `zerolog.Sampler`, so any custom zerolog sampler composes.
