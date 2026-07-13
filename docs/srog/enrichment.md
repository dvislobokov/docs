# Enrichment

Enrichment attaches ambient properties — a shard ID, a service name, a request ID — to every event a logger emits, without repeating them at each call site. Loggers are immutable: enrichment always derives a new child logger and leaves the parent untouched.

## ForContext

`ForContext(name, value)` is Serilog's namesake: a child logger that includes the property on every event.

```go
inv := log.ForContext("ShardId", 3)
inv.Information("rebalancing {Partitions} partitions", 12)
```

```json
{"level":"info","ShardId":3,"@mt":"rebalancing {Partitions} partitions","Partitions":12,"message":"rebalancing 12 partitions"}
```

Values are bound with typed zerolog context methods (`string`, `bool`, ints, `float64`, `time.Time`, `time.Duration`, `error`, and `Interface` fallback).

## Named

`Named(service)` tags a component with a `service` property — the idiomatic way to identify which subsystem emitted an event:

```go
billing := log.Named("billing")
billing.Information("invoice {InvoiceId} issued for {Amount}", "INV-2071", 129.90)
```

```json
{"level":"info","service":"billing","@mt":"invoice {InvoiceId} issued for {Amount}","InvoiceId":"INV-2071","Amount":129.9,"message":"invoice INV-2071 issued for 129.9"}
```

## ForContextValues

Attach several properties at once from a map:

```go
job := log.ForContextValues(map[string]any{
	"PipelineId": "pl-778",
	"Attempt":    2,
})
job.Warning("retrying flaky step {Step}", "integration-tests")
```

```json
{"level":"warn","PipelineId":"pl-778","Attempt":2,"@mt":"retrying flaky step {Step}","Step":"integration-tests","message":"retrying flaky step integration-tests"}
```

::: tip
Derived loggers share the parent's sinks — call `Close` once, on the root logger. Deriving is cheap; do it per request, per job, per connection.
:::

## Caller information

`WithCaller(true)` annotates each event with the logging call site as `"caller":"file:line"`. srog walks the stack and skips its own frames, so the reported caller is correct regardless of wrappers or inlining:

```json
{"level":"error","caller":"C:/dev/app/main.go:22", ...}
```

## Stack traces on errors

`WithStackTrace(true)` captures a call stack whenever an error is logged via `Error` or `Fatal`. The stack is stored as a single multi-line string under the `stack` field — one indexable block in Elasticsearch/OpenSearch — and pretty-printed by console sinks.

```go
log := srog.MustNew(
	srog.WithConsole(srog.NoColor()),
	srog.WithTimestamp(false),
	srog.WithStackTrace(true),
)

func chargeCard(log *srog.Logger) {
	log.Error(errors.New("card declined"), "charge failed for invoice {InvoiceId}", "INV-2071")
}
```

Console rendering (captured; directory prefix shortened for readability):

```txt
ERR charge failed for invoice INV-2071 card declined
    main.chargeCard
        .../enrichment/main.go:46
    main.main
        .../enrichment/main.go:42
```

The same event through a JSON sink carries the trace in `stack` (real capture, paths shortened):

```json
{"level":"error","caller":".../stackjson/main.go:22","error":"ledger out of balance","stack":"main.settle\n\t.../stackjson/main.go:22\nmain.main\n\t.../stackjson/main.go:18","@mt":"settlement aborted for batch {BatchId}","BatchId":20260713,"message":"settlement aborted for batch 20260713"}
```

srog strips its own leading frames, so the trace begins at the code that logged. Depth is capped at 32 frames, and `runtime.main`/`runtime.goexit` noise is trimmed.

### Per-logger control and custom stacks

`Logger.WithStackTrace(on)` toggles capture on a child logger. Its main use is attaching a *better* stack yourself — for example at panic recovery, where the useful frames only exist at `recover()` time:

```go
log.WithStackTrace(false).                             // suppress srog's own capture
	ForContext(srog.StackFieldName, string(debug.Stack())). // attach the real stack
	Error(err, "panic recovered: {Panic}", err.Error())
```

`srog.StackFieldName` (`"stack"`) is the exported name of the field the console sink pretty-prints. The [srogecho Recover middleware](./integrations.md#echo-srogecho) uses exactly this pattern.

## Request and correlation IDs

`srog.NewID()` returns a random 128-bit identifier as a 32-character hex string, suitable as a request or correlation ID:

```txt
srog.NewID() -> d7c83aa4634a24a99b6f50bef79dcd48
```

For carrying an enriched logger through `context.Context`, see [Context](./context.md).
