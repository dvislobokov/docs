# Quick Start

This page constructs a logger, logs at each level, and reads the output in both console and JSON form.

## Construct a logger

`srog.New` builds an immutable, concurrency-safe `*Logger` from functional options. With no sink option it defaults to a single JSON sink on `os.Stdout` at `Information` level. `srog.MustNew` panics instead of returning an error — safe for configurations without file sinks.

```go
log, err := srog.New(srog.WithConsole())   // colorized console on stdout
log := srog.MustNew()                      // JSON to stdout, Information level
log := srog.NewConsole()                   // dev preset: console, Debug level, stack traces
```

Call `log.Close()` on shutdown when file or async sinks are configured; it releases file handles and drains async queues.

## Log at each level

Level methods take a message template followed by the arguments that fill its holes, in order. `Error` and `Fatal` additionally take the triggering `error` as their first argument (pass `nil` if there is none).

```go
log := srog.MustNew(
	srog.WithConsole(srog.NoColor()),
	srog.WithLevel(srog.DebugLevel),
)
defer log.Close()

log.Debug("evaluating {Candidates} drivers near {Zone}", 14, "downtown-east")
log.Information("trip {TripId} assigned to driver {DriverId} eta {EtaSeconds}s", "T-58201", "D-107", 240)
log.Warning("surge multiplier {Multiplier} exceeds cap in {Zone}", 3.1, "airport")
log.Error(errors.New("driver socket closed"), "lost contact with driver {DriverId}", "D-107")
```

## Console vs JSON

The same four calls, through a console sink and through the default JSON sink:

::: code-group

```txt [Console]
2026-07-13T11:55:30+03:00 DBG evaluating 14 drivers near downtown-east
2026-07-13T11:55:30+03:00 INF trip T-58201 assigned to driver D-107 eta 240s
2026-07-13T11:55:30+03:00 WRN surge multiplier 3.1 exceeds cap in airport
2026-07-13T11:55:30+03:00 ERR lost contact with driver D-107 driver socket closed
```

```json [JSON]
{"level":"debug","@mt":"evaluating {Candidates} drivers near {Zone}","Candidates":14,"Zone":"downtown-east","time":"2026-07-13T11:55:30+03:00","message":"evaluating 14 drivers near downtown-east"}
{"level":"info","@mt":"trip {TripId} assigned to driver {DriverId} eta {EtaSeconds}s","TripId":"T-58201","DriverId":"D-107","EtaSeconds":240,"time":"2026-07-13T11:55:30+03:00","message":"trip T-58201 assigned to driver D-107 eta 240s"}
{"level":"warn","@mt":"surge multiplier {Multiplier} exceeds cap in {Zone}","Multiplier":3.1,"Zone":"airport","time":"2026-07-13T11:55:30+03:00","message":"surge multiplier 3.1 exceeds cap in airport"}
{"level":"error","error":"driver socket closed","@mt":"lost contact with driver {DriverId}","DriverId":"D-107","time":"2026-07-13T11:55:30+03:00","message":"lost contact with driver D-107"}
```

:::

Reading the JSON shape:

| Field | Meaning |
| --- | --- |
| `level` | zerolog level name (`debug`, `info`, `warn`, `error`, ...) |
| `@mt` | the raw message template — always present, groups events by template identity |
| `Candidates`, `Zone`, ... | typed structured fields bound from the template holes |
| `error` | attached error text (from `Error`/`Fatal`) |
| `time` | timestamp (RFC 3339 by default; configurable via `WithTimeFormat`) |
| `message` | the rendered human-readable message (omit with `WithRenderedMessage(false)`) |

The console format deliberately shows only the timestamp, level, rendered message, error, and caller — structured parameters stay in the JSON sinks.

::: info
Console output is colorized by default (ANSI codes). The captures above use `srog.NoColor()`; in a terminal you get colored level tags and a dimmed timestamp.
:::

## Both at once

A logger fans out to any number of sinks, each with its own format and level — the most common production setup is a pretty console plus a JSON file:

```go
log, err := srog.New(
	srog.WithConsole(srog.MinLevel(srog.DebugLevel)),
	srog.WithFile("/var/log/app.log", srog.MinLevel(srog.InformationLevel)),
)
if err != nil {
	panic(err)
}
defer log.Close()
```

Continue with [Message Templates](./message-templates.md) for the full template syntax, or [Sinks](./sinks.md) for everything about outputs.
