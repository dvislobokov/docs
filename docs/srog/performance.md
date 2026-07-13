# Performance

srog keeps zerolog's zero-allocation event model underneath its template layer. This page explains the hot-path design and reports the repository's own benchmarks executed on a real machine.

## Hot-path design

- **Template caching** — `parse` memoizes parsed templates in a `sync.Map` keyed by the raw string. Templates are typically string literals, so after the first call each template costs one lock-free map lookup.
- **Typed field binding** — hole values are bound with a type switch over concrete types (`string`, ints, floats, `time.Time`, `error`, ...) mapping to zerolog's typed field methods. Reflection is reserved for the `{@}` destructure operator and unknown types.
- **Pooled render buffers** — the human-readable message is built into a `sync.Pool` byte buffer; scalars are appended with `strconv.Append*`, not `fmt`.
- **Early level rejection** — a disabled level returns before anything is allocated.
- **Structured-only mode** — `WithRenderedMessage(false)` skips message rendering entirely; consumers use `@mt` plus the fields.
- **Single-sink fast path** — with one sink the fan-out writer and per-sink level wrappers are skipped.

## Benchmarks

These are the repository's own benchmarks (`srog_test.go`), run on this documentation build machine — Windows, AMD Ryzen 5 8400F, Go 1.25, srog commit `5b7f13a` — with the logger writing to `io.Discard` and timestamps disabled. Absolute numbers will differ on your hardware; the allocation counts are the point.

```sh
go test -run '^$' -bench . -benchmem ./...
```

```txt
goos: windows
goarch: amd64
pkg: github.com/dvislobokov/srog
cpu: AMD Ryzen 5 8400F 6-Core Processor
BenchmarkRendered-12          	 5274414	       219.7 ns/op	      48 B/op	       1 allocs/op
BenchmarkStructuredOnly-12    	 9408008	       130.3 ns/op	       0 B/op	       0 allocs/op
BenchmarkParseCached-12       	100000000	        11.12 ns/op	       0 B/op	       0 allocs/op
```

What each measures (a three-hole template: two strings, one int):

| Benchmark | Scenario | Result on this machine |
| --- | --- | --- |
| `BenchmarkRendered` | Full pipeline with message rendering | ~220 ns, 1 alloc (the returned message string) |
| `BenchmarkStructuredOnly` | `WithRenderedMessage(false)` — fields + `@mt` only | ~130 ns, **0 allocs** |
| `BenchmarkParseCached` | Cached template lookup | ~11 ns, 0 allocs |

The "0 allocations on the structured hot path" claim from the README reproduces exactly: template lookup, level check, and typed field binding all run allocation-free; the only allocation in rendered mode is the message string itself.

## Practical guidance

- For maximum throughput on machine-consumed logs, disable rendering: `srog.WithRenderedMessage(false)`. Structured consumers still get every field plus the raw template in `@mt`. Console sinks rely on the rendered message, so keep it on when using them.
- Guard genuinely expensive argument construction with `log.Enabled(level)` — the level check itself is already free.
- Slow destinations (network sinks, busy disks) belong behind `Async` (see [Sinks](./sinks.md#async-sinks)); the queue handoff copies the event once and never blocks the caller.
- Cap pathological log floods with `WithSampling` (`EveryN`, `BurstLimit`) rather than deleting log statements.
- `WithCaller` and `WithStackTrace` walk the runtime stack (`runtime.Callers` + frame resolution) — measurable but modest; stacks are only captured when an error is actually logged.
