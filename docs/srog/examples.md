# Examples

A cookbook of complete, copy-paste-ready recipes for every part of srog. Each example shows the code, the captured output, and the pattern it demonstrates — from the smallest possible logger to request-scoped logging across HTTP and gRPC. For the underlying rules, follow the links into the reference pages.

[[toc]]

## 1. The smallest possible logger

One import, one constructor, one call.

```go
package main

import (
	"errors"

	"github.com/dvislobokov/srog"
)

func main() {
	log := srog.MustNew(srog.WithConsole()) // colorized console on stdout, Information level
	defer log.Close()

	log.Information("order {OrderId} accepted for {Amount:.2f}", "ORD-1042", 249.5)
	log.Error(errors.New("gateway timeout"), "payment for {OrderId} failed", "ORD-1042")
}
```

```txt
2026-07-18T10:12:41+03:00 INF order ORD-1042 accepted for 249.50
2026-07-18T10:12:41+03:00 ERR payment for ORD-1042 failed gateway timeout
```

Variants of the constructor (see [Quick Start](./quick-start.md)):

```go
log, err := srog.New(srog.WithConsole()) // returns the error instead of panicking
log := srog.MustNew()                    // no options: JSON to stdout, Information level
log := srog.NewConsole()                 // dev preset: console, Debug level, stack traces
```

`Error` and `Fatal` take the triggering `error` as their first argument (pass `nil` if there is none). `Fatal` flushes all sinks and then calls `os.Exit(1)`.

## 2. Message templates: holes, formats, alignment

Named holes bind arguments **in order** and become typed JSON fields; the raw template is preserved in `@mt` for grouping. See [Message Templates](./message-templates.md) for the full grammar.

```go
log.Information("pallet {SKU} scanned at dock {Dock}", "SKU-4471", "D3")
log.Information("moved {0} units from {1} to {2}", 96, "A-14-2", "STAGE-1") // positional
log.Information("belt utilisation {Utilisation:.1f} percent", 87.3456)     // fmt verb, no leading %
log.Information("cycle finished at {FinishedAt:HH:mm:ss}", time.Now())     // time layout
log.Information("bin {Bin,-8}| qty {Qty,5}", "A-2", 7)                     // alignment
log.Information("schema is {{sku, units}} for lane {Lane}", 12)            // literal braces
```

```json
{"level":"info","@mt":"pallet {SKU} scanned at dock {Dock}","SKU":"SKU-4471","Dock":"D3","message":"pallet SKU-4471 scanned at dock D3"}
{"level":"info","@mt":"belt utilisation {Utilisation:.1f} percent","Utilisation":87.3456,"message":"belt utilisation 87.3 percent"}
```

Missing arguments echo the hole verbatim; surplus arguments become `extra_N` fields — neither is an error. Keep templates as **string literals**: parsed templates are cached by the raw string (cached lookup ~11 ns, zero allocations), and a stable `@mt` is what lets log pipelines group events.

## 3. Destructuring with `@` and stringify with `$`

`{@Name}` serializes a value as a structured JSON object; `{$Name}` forces its string form in both the message and the field.

```go
type Pallet struct {
	SKU      string
	Units    int
	Location string
}

p := Pallet{SKU: "SKU-4471", Units: 96, Location: "A-14-2"}
log.Information("received pallet {@Pallet}", p)
log.Information("raw payload {$Payload}", p)
```

```json
{"level":"info","@mt":"received pallet {@Pallet}","Pallet":{"SKU":"SKU-4471","Units":96,"Location":"A-14-2"},"message":"received pallet Pallet { SKU: \"SKU-4471\", Units: 96, Location: \"A-14-2\" }"}
{"level":"info","@mt":"raw payload {$Payload}","Payload":"{SKU-4471 96 A-14-2}","message":"raw payload {SKU-4471 96 A-14-2}"}
```

Destructuring handles structs, maps, slices, and pointers; `time.Time`, `time.Duration`, and `error` short-circuit to scalars, and recursion depth is bounded so cyclic objects cannot overflow.

## 4. Levels: logger-wide, per-sink, per-child

The ladder is `Verbose < Debug < Information < Warning < Error < Fatal` (see [Levels](./levels.md)). Three places to filter:

```go
// 1. Logger-wide default (events below are rejected before any allocation):
log := srog.MustNew(srog.WithConsole(), srog.WithLevel(srog.DebugLevel))

// 2. Per sink — console chatty, file quiet:
log := srog.MustNew(
	srog.WithConsole(srog.MinLevel(srog.DebugLevel)),
	srog.WithFile("app.log", srog.MinLevel(srog.WarningLevel)),
)

// 3. Per derived child — parent unchanged:
quiet := log.WithLevel(srog.ErrorLevel)
quiet.Information("filtered out")
```

`Enabled` guards genuinely expensive argument construction:

```go
if log.Enabled(srog.DebugLevel) {
	log.Debug("full graph {@Graph}", buildDebugGraph()) // only built when Debug is on
}
```

`ParseLevel` resolves Serilog-style names case-insensitively (`"warning"`, `"warn"`, `"info"`, `"trace"`, ...) — the same names the [config file](#9-configuration-from-a-json-file) accepts:

```go
lvl, err := srog.ParseLevel(os.Getenv("LOG_LEVEL")) // e.g. "debug"
```

::: tip Dynamic verbosity
Loggers are immutable — there is no runtime level mutation. Derive a child with `WithLevel` and swap it in; for the global logger, `srog.SetDefault` is atomic.
:::

## 5. Enrichment: ambient properties on every event

Enrichment derives a child logger that stamps properties on everything it emits (see [Enrichment](./enrichment.md)):

```go
inv := log.ForContext("ShardId", 3)                 // one property
billing := log.Named("billing")                     // "service":"billing"
job := log.ForContextValues(map[string]any{         // several at once
	"PipelineId": "pl-778",
	"Attempt":    2,
})

job.Warning("retrying flaky step {Step}", "integration-tests")
```

```json
{"level":"warn","PipelineId":"pl-778","Attempt":2,"@mt":"retrying flaky step {Step}","Step":"integration-tests","message":"retrying flaky step integration-tests"}
```

Deriving is cheap — do it per request, per job, per connection. Children share the parent's sinks, so call `Close` once, on the root.

## 6. Production fan-out: console plus rotated JSON file

The classic setup — pretty console for operators, machine JSON on disk for the shipper, each with its own threshold. See [Sinks](./sinks.md).

```go
log, err := srog.New(
	srog.WithLevel(srog.InformationLevel),
	srog.WithConsole(srog.MinLevel(srog.DebugLevel)),
	srog.WithFile("/var/log/app/app.log",
		srog.MinLevel(srog.InformationLevel),
		srog.Rotate(srog.Rotation{MaxSizeMB: 100, MaxBackups: 10, MaxAgeDays: 30, Compress: true}),
	),
	srog.WithErrorHandler(func(err error) {
		fmt.Fprintln(os.Stderr, "log sink failure:", err) // full disk, broken pipe, ...
	}),
)
if err != nil {
	panic(err) // e.g. the file's parent directory does not exist
}
defer log.Close()
```

::: warning
`WithFile` requires the parent directory to exist, and `Close` is what releases file handles and drains [async queues](#20-performance-async-sinks-sampling-structured-only) — always defer it on the root logger.
:::

Other destinations: `WithWriter(w, opts...)` turns any `io.Writer` into a sink (`os.Stderr`, a buffer, a network sink); the default format for file and writer sinks is JSON, override with `AsConsole()`, `AsECS()`, `AsOTel()`, or [`AsTemplate(...)`](#8-serilog-style-output-templates).

## 7. Rotation recipes

Size, time, or both — the triggers compose, and retention applies to the rotated backups. See [Rotation](./rotation.md).

```go
// Roll at ~100 MB, keep 10 gzipped backups no older than 30 days:
srog.WithFile("app.log", srog.Rotate(srog.Rotation{
	MaxSizeMB: 100, MaxBackups: 10, MaxAgeDays: 30, Compress: true,
}))

// Roll every midnight (UTC), two weeks of history:
srog.WithFile("app.log", srog.Rotate(srog.Rotation{
	Every: srog.Daily, MaxBackups: 14, Compress: true,
}))

// Both: daily cadence, but never let a single day's file exceed 500 MB:
srog.WithFile("app.log", srog.Rotate(srog.Rotation{
	Every: srog.Daily, MaxSizeMB: 500, MaxAgeDays: 7,
}))
```

Directory after a few rotations — the active file keeps its name, backups get a timestamp suffix and `.gz`:

```txt
app-2026-07-16T00-00-00.001.log.gz
app-2026-07-17T00-00-00.003.log.gz
app.log
```

`Hourly` rolls at the top of every hour; `LocalTime: true` computes boundaries in local time instead of UTC.

## 8. Serilog-style output templates

`AsTemplate` renders a sink through a Serilog output template — literal text plus placeholders, each supporting the same `,alignment` and `:format` specifiers as message templates:

```go
log := srog.MustNew(
	srog.WithConsole(srog.AsTemplate(
		"[{Timestamp:15:04:05} {Level:u3}] {Message} {Properties}{NewLine}{Exception}")),
)

log.ForContext("RequestId", "req-01998f").
	Information("order {OrderId} accepted", "ORD-1042")
```

```txt
[10:12:41 INF] order ORD-1042 accepted RequestId=req-01998f
```

Built-in placeholders: `{Timestamp[:layout]}`, `{Level[:u3|w3|u|w]}` (`u3` = `INF`, `u` = `INFORMATION`), `{Message}`, `{MessageTemplate}`, `{Exception}` (error text, stack on the next line, empty when no error), `{Caller}`, `{NewLine}`, `{Properties[:j]}` (every field the template did not consume; `:j` renders one compact JSON object). Any other name prints that event field — `{RequestId}`, `{Amount,10:.2f}` — and an absent field renders as empty, like Serilog.

The same layout is available declaratively: a sink entry with `"format": "template"` (or just a `"template"` key, which implies it) in the [config file](#9-configuration-from-a-json-file).

## 9. Configuration from a JSON file

Every construction option has a declarative counterpart (see [Configuration](./configuration.md) for the full schema):

```json
{
  "level": "debug",
  "stackTrace": true,
  "timeFormat": "rfc3339",
  "sinks": [
    { "type": "console", "level": "debug" },
    {
      "type": "file",
      "path": "/var/log/app/app.log",
      "level": "information",
      "rotation": { "maxSizeMB": 100, "maxBackups": 10, "compress": true, "every": "daily" }
    },
    { "type": "stderr", "level": "error", "format": "console", "noColor": true }
  ]
}
```

```go
log, err := srog.NewFromConfigFile("logging.json")
if err != nil {
	panic(err) // unknown level/format names produce descriptive errors
}
defer log.Close()
```

Step-by-step variants when you need the `Config` value in between:

```go
cfg, err := srog.LoadConfigFile("logging.json") // or srog.LoadConfig(anyReader)
log, err := cfg.Build()                         // == srog.NewFromConfig(cfg)
```

## 10. Configuration from YAML

`Config` carries `yaml` tags, so the same schema decodes with `gopkg.in/yaml.v3` — srog itself never depends on a YAML parser:

```yaml
# logging.yaml
level: debug
stackTrace: true
sinks:
  - type: console
  - type: file
    path: app.log
    level: information
    rotation:
      every: daily
      maxBackups: 14
      compress: true
```

```go
data, err := os.ReadFile("logging.yaml")
if err != nil {
	return err
}
var cfg srog.Config
if err := yaml.Unmarshal(data, &cfg); err != nil {
	return err
}
log, err := cfg.Build()
```

The same trick works for any decoder that fills the `Config` struct — including a configuration library that binds structs from layered sources: put the logging section in your app config, bind it into `srog.Config`, and call `Build()`.

## 11. Config file plus programmatic extras

Some options have no serializable form (`WithErrorHandler`, `WithSampling`, `WithWriter`). `Config.Options()` translates the file into the matching `[]Option` slice, and you append the rest:

```go
cfg, err := srog.LoadConfigFile("logging.json")
if err != nil {
	return err
}
opts, err := cfg.Options()
if err != nil {
	return err
}
log, err := srog.New(append(opts,
	srog.WithErrorHandler(reportSinkFailure),
	srog.WithSampling(srog.BurstLimit(100, time.Second, srog.EveryN(100))),
)...)
```

## 12. Custom sinks: `WithWriter` and registered sink types

Programmatically, any `io.Writer` is a sink; if it also implements `io.Closer`, `Logger.Close` closes it:

```go
errLog := srog.MustNew(srog.WithWriter(os.Stderr, srog.AsConsole()))
```

To make a custom destination usable in **config files**, register a sink type — the serializable counterpart of `WithWriter` (see [Registered sink types](./configuration.md#registered-sink-types)):

```go
srog.RegisterSinkType("mysink", func(cfg srog.Config, spec srog.SinkSpec) (io.Writer, srog.Format, error) {
	var o struct {
		URL string `json:"url"`
	}
	if err := spec.DecodeOptions(&o); err != nil {
		return nil, 0, err
	}
	return newMyWriter(o.URL), srog.FormatJSON, nil // writer may implement io.Closer
})
```

```json
{
  "sinks": [
    { "type": "console" },
    { "type": "mysink", "level": "warning", "options": { "url": "https://logs.internal/ingest" } }
  ]
}
```

Modules typically register in `init()`, so a blank import enables the type — that is how `import _ "github.com/dvislobokov/srog/srogotel"` makes `"type": "otlp"` available.

## 13. Passing a logger through `context.Context`

The core propagation pattern (see [Context](./context.md)): enrich once, store in the context, retrieve anywhere below — no logger parameters threaded through the call chain.

```go
// At the boundary (middleware, dispatcher, job runner):
reqLog := log.ForContext("RequestId", srog.NewID())
ctx := reqLog.IntoContext(ctx) // == srog.NewContext(ctx, reqLog)

// Anywhere below:
func assignTrip(ctx context.Context, tripID string) {
	srog.Ctx(ctx).Information("assigning trip {TripId}", tripID)
	srog.InfoCtx(ctx, "notified rider for trip {TripId}", tripID) // same, shorter
}
```

```json
{"level":"info","RequestId":"d7c83aa4634a24a99b6f50bef79dcd48","@mt":"assigning trip {TripId}","TripId":"T-58201","message":"assigning trip T-58201"}
{"level":"info","RequestId":"d7c83aa4634a24a99b6f50bef79dcd48","@mt":"notified rider for trip {TripId}","TripId":"T-58201","message":"notified rider for trip T-58201"}
```

`FromContext` and `Ctx` **never return nil** — with no stored logger they fall back to `srog.Default()`, so call sites log unconditionally. Prefer `Ctx` (or the `*Ctx` helpers) in application code: it additionally applies [context field extractors](#14-context-field-extractors-tenant-and-trace-correlation), and with none registered it costs no more than `FromContext`.

## 14. Context field extractors: tenant and trace correlation

`AddContextField` registers a function that pulls correlation fields out of any context on every `Ctx` call — without srog depending on the packages that put them there:

```go
type tenantKey struct{}

func main() {
	srog.AddContextField(func(ctx context.Context) []srog.Field {
		if t, ok := ctx.Value(tenantKey{}).(string); ok {
			return []srog.Field{{Name: "tenant", Value: t}}
		}
		return nil
	})
	// ...
}
```

```json
{"level":"info","RequestId":"req-01998f","tenant":"acme-fresh","@mt":"assigning trip {TripId}","TripId":"T-58201","message":"assigning trip T-58201"}
```

For OpenTelemetry trace correlation, the `srogotel` module ships a ready-made extractor — one line at startup and every context-scoped event carries `trace_id`/`span_id`:

```go
import "github.com/dvislobokov/srog/srogotel"

srogotel.Install()
```

```json
{"level":"info","trace_id":"7a32e3b7222cef22b21a776beaf05c2d","span_id":"ffa2cea413d07212","@mt":"trip {TripId} assigned","TripId":"T-58201","message":"trip T-58201 assigned"}
```

Register extractors once at startup; the read path is lock-free.

## 15. HTTP: the sroghttp middleware end to end

`sroghttp.Middleware` (part of the main module, stdlib only) does the whole request-logging job: it resolves or generates a request ID (`X-Request-Id` header, echoed on the response), stores an enriched logger in the request context, and logs completion with method, path, status, bytes, remote address, and duration. 5xx logs `Error`, 4xx `Warning`, everything else `Information`. See [Integrations](./integrations.md#nethttp-sroghttp).

```go
package main

import (
	"encoding/json"
	"net/http"

	"github.com/dvislobokov/srog"
	"github.com/dvislobokov/srog/sroghttp"
)

func main() {
	log := srog.MustNew(
		srog.WithConsole(srog.MinLevel(srog.DebugLevel)),
		srog.WithFile("http.log", srog.MinLevel(srog.InformationLevel)),
	)
	defer log.Close()

	mux := http.NewServeMux()
	mux.HandleFunc("GET /parcels/{id}", func(w http.ResponseWriter, r *http.Request) {
		// The request-scoped logger already carries the RequestId:
		srog.FromContext(r.Context()).Information("looking up parcel {ParcelId}", r.PathValue("id"))
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "in_transit"})
	})

	handler := sroghttp.Middleware(log,
		sroghttp.WithStartLog(true), // also log "--> {Method} {Path}" at request start
		sroghttp.WithSkip(func(r *http.Request) bool { return r.URL.Path == "/healthz" }),
	)(mux)

	log.Information("listening on {Addr}", ":8080")
	http.ListenAndServe(":8080", handler)
}
```

Captured from real requests — the handler line and the completion line share one `RequestId`, and the 404 was logged as a warning:

```json
{"level":"info","RequestId":"d220e3cd24d65267474833ff6166d469","@mt":"looking up parcel {ParcelId}","ParcelId":"PK-99012","message":"looking up parcel PK-99012"}
{"level":"info","RequestId":"d220e3cd24d65267474833ff6166d469","duration_ms":0,"status":200,"bytes":23,"remote":"127.0.0.1:64193","@mt":"{Method} {Path} -> {Status}","Method":"GET","Path":"/parcels/PK-99012","Status":200,"message":"GET /parcels/PK-99012 -> 200"}
{"level":"warn","RequestId":"20789916c6ec9c489354ede09a7ee888","status":404,"bytes":19,"remote":"127.0.0.1:64194","duration_ms":0,"@mt":"{Method} {Path} -> {Status}","Method":"GET","Path":"/missing","Status":404,"message":"GET /missing -> 404"}
```

Options: `WithHeader(name)`, `WithField(name)` (default `"RequestId"`), `WithIDGenerator(fn)`, `WithSkip(pred)`, `WithStartLog(on)`. The response wrapper exposes `Unwrap`, so `http.ResponseController` (Flush, Hijack, deadlines) keeps working. For the Echo framework there is a native equivalent plus panic recovery — see [srogecho](./integrations.md#echo-srogecho).

## 16. Writing your own HTTP middleware

When you need a custom shape (extra fields, different completion template), the same three moves — derive, store, log on completion — are a dozen lines:

```go
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

func Logging(base *srog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()

			id := r.Header.Get("X-Request-Id")
			if id == "" {
				id = srog.NewID()
			}
			reqLog := base.ForContext("RequestId", id)

			rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
			next.ServeHTTP(rec, r.WithContext(reqLog.IntoContext(r.Context())))

			reqLog.Information("{Method} {Path} -> {Status} in {DurationMs}ms",
				r.Method, r.URL.Path, rec.status, time.Since(start).Milliseconds())
		})
	}
}
```

```json
{"level":"info","RequestId":"3f90b723f8fc12a7a0a1d21450857dfd","@mt":"{Method} {Path} -> {Status} in {DurationMs}ms","Method":"GET","Path":"/parcels/PK-99012","Status":200,"DurationMs":2,"message":"GET /parcels/PK-99012 -> 200 in 2ms"}
```

Handlers stay identical either way: `srog.FromContext(r.Context())` / `srog.Ctx(r.Context())`.

## 17. gRPC: unary and stream interceptors

`sroggrpc` (separate module: `go get github.com/dvislobokov/srog/sroggrpc`) mirrors the HTTP middleware for gRPC: request ID from incoming metadata (`x-request-id` by default, also set as a response header), request-scoped logger in the call context, and a completion event `gRPC {Method} -> {Code}` with `method`, `code`, and `duration_ms`. `OK` logs Information, client-fault codes (`InvalidArgument`, `NotFound`, `PermissionDenied`, ...) log Warning, everything else logs Error with the error attached.

```go
srv := grpc.NewServer(
	grpc.ChainUnaryInterceptor(
		sroggrpc.UnaryServerInterceptor(log,
			sroggrpc.WithMetadataKey("x-request-id"),
			sroggrpc.WithField("RequestId"),
		),
	),
	grpc.ChainStreamInterceptor(
		sroggrpc.StreamServerInterceptor(log),
	),
)
```

Unary handlers pull the logger from the call context; streaming handlers use `ss.Context()`, which the interceptor wraps:

```go
func (s *tripServer) AssignTrip(ctx context.Context, req *pb.AssignTripRequest) (*pb.AssignTripResponse, error) {
	srog.FromContext(ctx).Information("assigning trip {TripId} to {DriverId}",
		req.GetTripId(), req.GetDriverId())
	// ...
	return &pb.AssignTripResponse{}, nil
}

func (s *tripServer) StreamPositions(req *pb.StreamRequest, ss pb.Trips_StreamPositionsServer) error {
	log := srog.FromContext(ss.Context()) // interceptor-wrapped stream context
	log.Information("position stream opened for {TripId}", req.GetTripId())
	// ...
	return nil
}
```

A client supplies (or propagates) the correlation ID as outgoing metadata:

```go
ctx = metadata.AppendToOutgoingContext(ctx, "x-request-id", srog.NewID())
resp, err := client.AssignTrip(ctx, req)
```

```json
{"level":"info","RequestId":"req-demo-1","@mt":"assigning trip {TripId} to {DriverId}","TripId":"T-58201","DriverId":"D-107","message":"assigning trip T-58201 to D-107"}
{"level":"info","RequestId":"req-demo-1","method":"/trips.Trips/AssignTrip","code":"OK","duration_ms":1,"@mt":"gRPC {Method} -> {Code}","Method":"/trips.Trips/AssignTrip","Code":"OK","message":"gRPC /trips.Trips/AssignTrip -> OK"}
```

Options: `WithMetadataKey`, `WithField`, `WithIDGenerator` — see [Integrations](./integrations.md#grpc-sroggrpc).

## 18. One correlation convention across HTTP and gRPC

In a service mesh, centralize the field and header names in one tiny package so every service — and every transport — wires logging identically (the full version ships as `examples/shared-convention` in the srog repository):

```go
package platformlog

const (
	Field  = "CorrelationId"    // structured log field name
	Header = "X-Correlation-Id" // HTTP header
	mdKey  = "x-correlation-id" // gRPC metadata key (gRPC lowercases keys)
)

func HTTPMiddleware(log *srog.Logger) func(http.Handler) http.Handler {
	return sroghttp.Middleware(log, sroghttp.WithField(Field), sroghttp.WithHeader(Header))
}

func GRPCUnary(log *srog.Logger) grpc.UnaryServerInterceptor {
	return sroggrpc.UnaryServerInterceptor(log,
		sroggrpc.WithField(Field), sroggrpc.WithMetadataKey(mdKey))
}

// Propagate the id to a downstream gRPC call so its interceptor binds the same one:
func PropagateGRPC(ctx context.Context, id string) context.Context {
	return metadata.AppendToOutgoingContext(ctx, mdKey, id)
}
```

Handlers never reference the field name — they keep using `srog.FromContext`. Change a constant here and every service picks it up on rebuild. An HTTP request that fans out into a gRPC call now produces log lines in **both services** sharing one `CorrelationId`.

## 19. Error logging: stacks, caller, panic recovery

`WithStackTrace(true)` captures a call stack whenever an error is logged; `WithCaller(true)` adds the `file:line` of the call site. See [Enrichment](./enrichment.md#stack-traces-on-errors).

```go
log := srog.MustNew(
	srog.WithConsole(),
	srog.WithCaller(true),
	srog.WithStackTrace(true),
)

func chargeCard(log *srog.Logger, invoiceID string) error {
	if err := gateway.Charge(invoiceID); err != nil {
		log.Error(err, "charge failed for invoice {InvoiceId}", invoiceID)
		return fmt.Errorf("charge %s: %w", invoiceID, err)
	}
	return nil
}
```

```txt
ERR charge failed for invoice INV-2071 card declined
    main.chargeCard
        .../billing/main.go:46
    main.main
        .../billing/main.go:42
```

The stack lands in JSON as one multi-line string under `stack` (`srog.StackFieldName`), which console sinks pretty-print and the ECS format maps to `error.stack_trace`. srog strips its own frames, so the trace begins at your code.

At panic recovery the useful frames only exist at `recover()` time, so suppress srog's capture and attach the real stack yourself:

```go
defer func() {
	if p := recover(); p != nil {
		err := fmt.Errorf("%v", p)
		log.WithStackTrace(false).
			ForContext(srog.StackFieldName, string(debug.Stack())).
			Error(err, "panic recovered: {Panic}", p)
	}
}()
```

This is exactly what the [srogecho Recover middleware](./integrations.md#echo-srogecho) does for Echo handlers.

::: tip
Log an error **once**, at the level that has the context to describe it; wrap and return it everywhere else (`fmt.Errorf("...: %w", err)`). Logging at every level of the stack multiplies the same failure into noise.
:::

## 20. Performance: async sinks, sampling, structured-only

Three orthogonal knobs (numbers and design in [Performance](./performance.md)):

```go
log := srog.MustNew(
	// 1. Slow destinations behind a bounded, non-blocking queue —
	//    a full queue drops rather than blocking; drops are reported via
	//    the error handler on Close. <=0 uses the default size of 1024.
	srog.WithFile("app.log", srog.Async(4096)),

	// 2. Flood control after level filtering: up to 100 events/second,
	//    then 1 in 100.
	srog.WithSampling(srog.BurstLimit(100, time.Second, srog.EveryN(100))),

	// 3. Machine-only consumers: skip message rendering entirely —
	//    the structured hot path then allocates nothing.
	srog.WithRenderedMessage(false),
)
defer log.Close() // drains the async queue — without it, queued events are lost
```

With rendering off, consumers still get every typed field plus the raw template in `@mt`:

```json
{"level":"info","@mt":"trip {TripId} assigned to driver {DriverId}","TripId":"T-58201","DriverId":"D-107"}
```

Keep rendering **on** for console sinks — they print the rendered message. The repository benchmarks: ~220 ns/1 alloc rendered, ~130 ns/0 allocs structured-only, ~11 ns cached template lookup.

## 21. Testing: capturing and asserting log output

A buffer sink plus `WithTimestamp(false)` gives deterministic NDJSON to assert on — no files, no globals:

```go
func TestChargeLogsInvoice(t *testing.T) {
	var buf bytes.Buffer
	log := srog.MustNew(
		srog.WithWriter(&buf), // JSON by default
		srog.WithTimestamp(false),
		srog.WithLevel(srog.DebugLevel),
	)

	chargeCard(log, "INV-2071") // code under test takes *srog.Logger

	var evt map[string]any
	if err := json.Unmarshal(buf.Bytes(), &evt); err != nil {
		t.Fatalf("not JSON: %v\n%s", err, buf.String())
	}
	if evt["level"] != "error" || evt["InvoiceId"] != "INV-2071" {
		t.Fatalf("unexpected event: %v", evt)
	}
	// Group-by-template assertions stay stable across message rewording:
	if evt["@mt"] != "charge failed for invoice {InvoiceId}" {
		t.Fatalf("template changed: %v", evt["@mt"])
	}
}
```

For code that logs through the context, hand the test its own logger the same way middleware would:

```go
ctx := srog.MustNew(srog.WithWriter(&buf), srog.WithTimestamp(false)).
	IntoContext(context.Background())
assignTrip(ctx, "T-58201")
```

With multiple events, split `buf.Bytes()` on newlines and decode each line — the output is NDJSON, one event per line.

## 22. The global logger and `Fatal` semantics

The package-level facade mirrors Serilog's static `Log` class and backs the context fallback. Configure it once in `main`:

```go
func main() {
	srog.SetDefault(srog.MustNew(
		srog.WithConsole(),
		srog.WithLevel(srog.DebugLevel),
	))
	defer srog.Default().Close()

	srog.Information("dispatcher ready on {Region}", "eu-central")
	srog.ForContext("component", "matcher").Information("matcher tick complete")

	if err := run(); err != nil {
		// Fatal logs, flushes ALL sinks (file and async included), then os.Exit(1).
		srog.Fatal(err, "dispatcher terminated")
	}
}
```

`SetDefault` swaps the logger atomically, so it is safe to call concurrently with logging; the initial default is a JSON logger on stdout, which is why `srog.FromContext` on a bare context still works.

::: warning
`Fatal` calls `os.Exit(1)` — deferred functions do not run. It does flush sinks first, so the final event reaches disk, but any *other* cleanup you deferred is skipped. Prefer returning errors to `main` and calling `Fatal` exactly once, at the top.
:::

For the complete list of exported symbols behind every recipe on this page, see the [API Reference](./api.md).
