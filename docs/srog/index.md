# srog

srog is a structured logging library for Go that speaks Serilog's message-template language on top of [zerolog](https://github.com/rs/zerolog). You write a message once — named holes in the template become typed structured fields, and a human-readable line is rendered alongside them.

## Why message templates

Traditional loggers force a choice: `fmt`-style messages that are pleasant to read but opaque to machines, or key-value APIs that are queryable but verbose to write. Message templates give you both from a single call:

```go
log.Information("trip {TripId} assigned to driver {DriverId} eta {EtaSeconds}s", "T-58201", "D-107", 240)
```

- `{TripId}`, `{DriverId}` and `{EtaSeconds}` become **typed JSON fields** (`"TripId":"T-58201"`, `"EtaSeconds":240`).
- The rendered message `trip T-58201 assigned to driver D-107 eta 240s` is emitted for humans.
- The raw template is preserved in the `@mt` field, so log pipelines can group events by their template identity — exactly like Serilog.

## Features

- **Serilog message templates** — named holes `{Name}`, destructuring `{@obj}`, stringify `{$obj}`, alignment, format specifiers, positional holes. Parsed templates are cached, so each template string is parsed once per process.
- **Multi-sink fan-out** — pretty console output *and* rotated JSON files at once, each sink with its own format and minimum level.
- **Four output formats** — human console, NDJSON, Elastic Common Schema (ECS), and OpenTelemetry OTLP/JSON log records.
- **Log rotation** — by size and/or time (hourly/daily), with backup and age retention plus gzip compression.
- **Request-scoped logging** — propagate an enriched logger through `context.Context`; pluggable context extractors add correlation fields such as OpenTelemetry `trace_id`/`span_id`.
- **Declarative configuration** — build the same logger from a JSON (or YAML) config file, with pluggable sink types registered by integration modules.
- **Async sinks** — offload slow destinations to a background goroutine with a bounded, non-blocking queue.
- **Integrations** — `net/http` middleware, gRPC interceptors, Echo middleware, a direct Elasticsearch sink, and OpenTelemetry both ways: trace-correlation fields and direct log export to the Collector over OTLP.
- **Fast** — zerolog's zero-allocation event model underneath; the structured-only hot path allocates nothing (see [Performance](./performance.md)).

## Installation

```sh
go get github.com/dvislobokov/srog
```

Integration subpackages with heavier dependencies live in their own Go modules and are fetched separately, for example:

```sh
go get github.com/dvislobokov/srog/sroggrpc
go get github.com/dvislobokov/srog/srogecho
go get github.com/dvislobokov/srog/srogelastic
go get github.com/dvislobokov/srog/srogotel
```

The `sroghttp` middleware ships inside the main module (standard library only).

## A minimal example

```go
package main

import (
	"errors"

	"github.com/dvislobokov/srog"
)

func main() {
	log := srog.MustNew(
		srog.WithConsole(srog.NoColor()),
		srog.WithLevel(srog.DebugLevel),
	)
	defer log.Close()

	log.Debug("evaluating {Candidates} drivers near {Zone}", 14, "downtown-east")
	log.Information("trip {TripId} assigned to driver {DriverId} eta {EtaSeconds}s", "T-58201", "D-107", 240)
	log.Warning("surge multiplier {Multiplier} exceeds cap in {Zone}", 3.1, "airport")
	log.Error(errors.New("driver socket closed"), "lost contact with driver {DriverId}", "D-107")
}
```

Real captured output:

```txt
2026-07-13T11:55:30+03:00 DBG evaluating 14 drivers near downtown-east
2026-07-13T11:55:30+03:00 INF trip T-58201 assigned to driver D-107 eta 240s
2026-07-13T11:55:30+03:00 WRN surge multiplier 3.1 exceeds cap in airport
2026-07-13T11:55:30+03:00 ERR lost contact with driver D-107 driver socket closed
```

Swap the console sink for the default JSON sink and the same calls produce structured NDJSON:

```json
{"level":"info","@mt":"trip {TripId} assigned to driver {DriverId} eta {EtaSeconds}s","TripId":"T-58201","DriverId":"D-107","EtaSeconds":240,"time":"2026-07-13T11:55:30+03:00","message":"trip T-58201 assigned to driver D-107 eta 240s"}
```

::: tip
Every example in this documentation is a compiled, executed Go program; all shown output is captured from real runs.
:::

## Documentation map

| Page | Contents |
| --- | --- |
| [Quick Start](./quick-start.md) | Construct a logger, log at each level, console vs JSON |
| [Message Templates](./message-templates.md) | Full template syntax reference |
| [Levels](./levels.md) | Severity ladder, filtering, per-sink levels |
| [Enrichment](./enrichment.md) | `ForContext`, `Named`, stack traces, caller info |
| [Sinks](./sinks.md) | Console, file, writer sinks; fan-out; async mode |
| [Rotation](./rotation.md) | Size/time rotation, retention, compression |
| [Configuration](./configuration.md) | JSON config file schema |
| [Context](./context.md) | Request-scoped logging and propagation |
| [Integrations](./integrations.md) | HTTP, gRPC, Echo, Elasticsearch, OpenTelemetry |
| [Performance](./performance.md) | Benchmarks and hot-path design |
| [API Reference](./api.md) | Every exported symbol |

Source: [github.com/dvislobokov/srog](https://github.com/dvislobokov/srog)
