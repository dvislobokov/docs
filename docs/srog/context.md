# Context

Request-scoped logging carries an enriched logger through `context.Context`: middleware attaches a logger with a request ID once, and every function below it logs with full correlation without threading a logger parameter through the call chain.

## Storing and retrieving a logger

| Function | Role |
| --- | --- |
| `srog.NewContext(ctx, l)` | Returns a copy of `ctx` carrying `l` |
| `l.IntoContext(ctx)` | Fluent counterpart of `NewContext` |
| `srog.FromContext(ctx)` | The logger stored in `ctx`, or the package default. **Never nil** |
| `srog.Ctx(ctx)` | Like `FromContext`, plus fields from registered context extractors |

The key is an unexported zero-size type, so it cannot collide with other packages' context keys.

```go
// A dispatcher enriches the logger per request and stores it in the context.
reqLog := base.ForContext("RequestId", "req-01998f")
ctx := reqLog.IntoContext(context.Background())

func handleAssignment(ctx context.Context, tripID string) {
	srog.Ctx(ctx).Information("assigning trip {TripId}", tripID)
	srog.InfoCtx(ctx, "notified rider for trip {TripId}", tripID) // package-level shorthand
}
```

```json
{"level":"info","RequestId":"req-01998f","@mt":"assigning trip {TripId}","TripId":"T-58201","message":"assigning trip T-58201"}
{"level":"info","RequestId":"req-01998f","@mt":"notified rider for trip {TripId}","TripId":"T-58201","message":"notified rider for trip T-58201"}
```

When no logger is stored, `FromContext`/`Ctx` fall back to `srog.Default()`, so call sites can log unconditionally:

```json
{"level":"info","@mt":"no request logger attached","message":"no request logger attached"}
```

## Context field extractors

`AddContextField` registers a `ContextFieldFunc` that pulls correlation fields out of a context — OpenTelemetry trace IDs, a tenant, anything context-carried — without srog depending on those packages. Registered extractors run on **every** `Ctx` call (and the `*Ctx` package helpers). Register once at startup; the read path is lock-free.

```go
type Field struct {
	Name  string
	Value any
}
type ContextFieldFunc func(ctx context.Context) []Field
```

```go
type tenantKey struct{}

srog.AddContextField(func(ctx context.Context) []srog.Field {
	if t, ok := ctx.Value(tenantKey{}).(string); ok {
		return []srog.Field{{Name: "tenant", Value: t}}
	}
	return nil
})
```

With the extractor installed, the earlier calls also carry the tenant (captured):

```json
{"level":"info","RequestId":"req-01998f","tenant":"acme-fresh","@mt":"assigning trip {TripId}","TripId":"T-58201","message":"assigning trip T-58201"}
```

The `srogotel` module ships a ready-made extractor for `trace_id`/`span_id` — see [Integrations](./integrations.md#opentelemetry-correlation-srogotel).

::: tip FromContext vs Ctx
`FromContext` is the cheapest resolution — just the stored logger. `Ctx` additionally applies extractors, deriving an enriched child when they yield fields; with no extractors registered it costs no more than `FromContext`. Prefer `Ctx` (or the `*Ctx` helpers) in application code so correlation fields are never missed.
:::

## Context-first package helpers

Each resolves the logger with `Ctx` and logs through it — no local logger variable needed:

```go
srog.VerboseCtx(ctx, tmpl, args...)
srog.DebugCtx(ctx, tmpl, args...)
srog.InformationCtx(ctx, tmpl, args...)
srog.InfoCtx(ctx, tmpl, args...)      // alias for InformationCtx
srog.WarningCtx(ctx, tmpl, args...)
srog.ErrorCtx(ctx, err, tmpl, args...)
srog.FatalCtx(ctx, err, tmpl, args...)
```

## The global logger

The package-level facade mirrors Serilog's static `Log` class and backs the context fallback:

```go
srog.SetDefault(srog.MustNew(
	srog.WithConsole(srog.NoColor()),
	srog.WithTimestamp(false),
	srog.WithLevel(srog.DebugLevel),
))
defer srog.Default().Close()

srog.Debug("warming route cache with {Entries} entries", 1250)
srog.Information("dispatcher ready on {Region}", "eu-central")
srog.Warning("driver pool low in {Zone}: {Available} available", "harbor", 2)
srog.ForContext("component", "matcher").Information("matcher tick complete")
```

```txt
DBG warming route cache with 1250 entries
INF dispatcher ready on eu-central
WRN driver pool low in harbor: 2 available
INF matcher tick complete
```

The default starts as a JSON logger on stdout; `SetDefault` swaps it atomically, so it is safe to call concurrently with logging.

## Propagation pattern

The end-to-end pattern used by the [HTTP, gRPC, and Echo integrations](./integrations.md):

1. Middleware resolves or generates a request ID (`srog.NewID`).
2. It derives `log.ForContext("RequestId", id)` and stores it with `NewContext`/`IntoContext`.
3. Handlers and everything below log via `srog.Ctx(ctx)` / `srog.InfoCtx(ctx, ...)`.
4. Extractors (tenant, trace IDs) enrich every one of those events automatically.
