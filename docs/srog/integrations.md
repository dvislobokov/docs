# Integrations

srog ships first-party integrations for HTTP servers, gRPC, the Echo framework, Elasticsearch, and OpenTelemetry, plus ECS and OTLP output formats for log pipelines. `sroghttp` lives in the main module; the others are separate Go modules fetched with `go get github.com/dvislobokov/srog/<name>`.

## net/http (sroghttp)

`sroghttp.Middleware` attaches a request-scoped logger to each request: it resolves or generates a request ID (header `X-Request-Id` by default, echoed on the response), stores the enriched logger in the request context, and logs completion with status, byte count, remote address, and duration. The completion level follows the status code: 5xx logs `Error`, 4xx logs `Warning`, everything else `Information`.

```go
mux := http.NewServeMux()
mux.HandleFunc("GET /parcels/{id}", func(w http.ResponseWriter, r *http.Request) {
	// The request-scoped logger already carries the RequestId.
	srog.FromContext(r.Context()).Information("looking up parcel {ParcelId}", r.PathValue("id"))
	w.Write([]byte(`{"status":"in_transit"}`))
})

handler := sroghttp.Middleware(log,
	sroghttp.WithSkip(func(r *http.Request) bool { return r.URL.Path == "/healthz" }),
)(mux)

http.ListenAndServe(":8080", handler)
```

Captured output from real requests (200, 404, 500 — the `/healthz` probe produced no lines):

```json
{"level":"info","RequestId":"d220e3cd24d65267474833ff6166d469","@mt":"looking up parcel {ParcelId}","ParcelId":"PK-99012","message":"looking up parcel PK-99012"}
{"level":"info","RequestId":"d220e3cd24d65267474833ff6166d469","duration_ms":0,"status":200,"bytes":23,"remote":"127.0.0.1:64193","@mt":"{Method} {Path} -> {Status}","Method":"GET","Path":"/parcels/PK-99012","Status":200,"message":"GET /parcels/PK-99012 -> 200"}
{"level":"warn","RequestId":"20789916c6ec9c489354ede09a7ee888","status":404,"bytes":19,"remote":"127.0.0.1:64194","duration_ms":0,"@mt":"{Method} {Path} -> {Status}","Method":"GET","Path":"/missing","Status":404,"message":"GET /missing -> 404"}
{"level":"error","RequestId":"3f90b723f8fc12a7a0a1d21450857dfd","duration_ms":0,"status":500,"bytes":15,"remote":"127.0.0.1:64195","@mt":"{Method} {Path} -> {Status}","Method":"GET","Path":"/boom","Status":500,"message":"GET /boom -> 500"}
```

Options: `WithHeader(name)`, `WithField(name)` (default `"RequestId"`), `WithIDGenerator(fn)`, `WithSkip(pred)`, `WithStartLog(on)` (also log a `--> {Method} {Path}` line when the request begins). The response wrapper exposes `Unwrap`, so `http.ResponseController` (Flush, Hijack, deadlines) keeps working.

## gRPC (sroggrpc)

`go get github.com/dvislobokov/srog/sroggrpc`

Unary and stream server interceptors mirror the HTTP middleware: request ID from incoming metadata (`x-request-id` by default, also set as a response header), request-scoped logger via `srog.NewContext`, and a completion event `gRPC {Method} -> {Code}` with `method`, `code`, and `duration_ms`. Level by status code: `OK` logs Information; client-side codes (`InvalidArgument`, `NotFound`, `PermissionDenied`, `Unauthenticated`, `Canceled`, `AlreadyExists`, `FailedPrecondition`, `OutOfRange`, `ResourceExhausted`) log Warning; everything else logs Error with the error attached.

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

Handlers retrieve the logger with `srog.FromContext(ctx)` (streaming handlers via `ss.Context()`, which the interceptor wraps). Options: `WithMetadataKey`, `WithField`, `WithIDGenerator`.

## Echo (srogecho)

`go get github.com/dvislobokov/srog/srogecho`

Echo-native middleware (reads status and byte counts from Echo's own `*Response` rather than double-wrapping), plus a panic-recovery middleware and a request-logger accessor:

```go
e := echo.New()
e.Use(srogecho.Middleware(log)) // request-scoped logger + access log
e.Use(srogecho.Recover(log))    // panics -> srog with the real stack

e.GET("/fleet/:id", func(c echo.Context) error {
	srogecho.From(c).Information("fetching vehicle {VehicleId}", c.Param("id"))
	return c.JSON(http.StatusOK, map[string]string{"state": "charging"})
})
```

Captured output (stack string elided for brevity — it is the full `debug.Stack()` capture from the panic site):

```json
{"level":"info","RequestId":"e925411f72cdbab9c8c4b787aaa14b32","@mt":"fetching vehicle {VehicleId}","VehicleId":"EV-204","message":"fetching vehicle EV-204"}
{"level":"info","RequestId":"e925411f72cdbab9c8c4b787aaa14b32","status":200,"bytes":21,"remote":"127.0.0.1","duration_ms":0.531,"@mt":"{Method} {Path} -> {Status}","Method":"GET","Path":"/fleet/EV-204","Status":200,"message":"GET /fleet/EV-204 -> 200"}
{"level":"error","RequestId":"8927683cf0d67cff4eb3b2576d170c75","stack":"goroutine 35 [running]: ...","error":"telemetry buffer overrun","@mt":"panic recovered: {Panic}","Panic":"telemetry buffer overrun","message":"panic recovered: telemetry buffer overrun"}
{"level":"error","RequestId":"8927683cf0d67cff4eb3b2576d170c75","status":500,"bytes":36,"remote":"127.0.0.1","duration_ms":0,"@mt":"{Method} {Path} -> {Status}","Method":"GET","Path":"/panic","Status":500,"message":"GET /panic -> 500"}
```

`Recover` captures the stack at `recover()` time — where the panic frames still exist — attaches it under `srog.StackFieldName`, and responds 500 through Echo's error handler. Install it *after* `Middleware` so the completion line is still produced. On handler errors the middleware unwraps `echo.HTTPError` to log the internal cause rather than the HTTP wrapper. Options match sroghttp: `WithHeader` (default `echo.HeaderXRequestID`), `WithField`, `WithIDGenerator`, `WithSkip`, `WithStartLog`.

## ECS output for Elasticsearch / Kibana

The `AsECS()` sink format (or `"format": "ecs"` in config) rewrites each event with [Elastic Common Schema](https://www.elastic.co/guide/en/ecs/current/index.html) field names, so events index into Elasticsearch and render in Kibana without a Logstash/ingest mapping:

| zerolog field | ECS field |
| --- | --- |
| `time` | `@timestamp` |
| `level` | `log.level` |
| `message` | `message` |
| `error` | `error.message` |
| `stack` | `error.stack_trace` |
| `caller` (`file:line`) | `log.origin.file.name` + `log.origin.file.line` |
| `@mt` | `message_template.text` |
| (added) | `ecs.version: "8.11.0"` |

Template fields pass through unchanged. Captured:

```json
{"@timestamp":"2026-07-13T11:56:07+03:00","Kwh":14.267,"MeterId":"M-3312","ecs.version":"8.11.0","log.level":"info","message":"meter M-3312 reported 14.27 kWh","message_template.text":"meter {MeterId} reported {Kwh:.2f} kWh"}
{"@timestamp":"2026-07-13T11:56:07+03:00","MeterId":"M-3312","ecs.version":"8.11.0","error.message":"checksum mismatch","log.level":"error","message":"rejected reading from M-3312","message_template.text":"rejected reading from {MeterId}"}
```

::: tip ELK via Fluent Bit
For the classic tail-and-ship pipeline, write an ECS (or plain JSON) file sink and let Fluent Bit tail it. The default RFC 3339 timestamp parses cleanly with `Time_Key time` (JSON) or `Time_Key @timestamp` (ECS).
:::

## Elasticsearch direct sink (srogelastic)

`go get github.com/dvislobokov/srog/srogelastic`

An opt-in sink that ships events straight to Elasticsearch's `_bulk` API over plain HTTP — no Elasticsearch client dependency. `Write` only copies the event into a bounded queue and returns; batching, HTTP, retries with exponential backoff, and node round-robin happen on a background goroutine. A full queue drops (and counts) events rather than blocking the application.

```go
opt, sink, err := srogelastic.WithElasticsearch(srogelastic.Config{
	Addresses: []string{"http://localhost:9200"},
	Index:     "dispatch-logs",
	OnError:   func(err error) { fmt.Println("ship error:", err) },
})
if err != nil {
	panic(err)
}
defer sink.Close() // flushes the queue

log := srog.MustNew(srog.WithConsole(), opt) // opt = WithWriter(sink, AsECS())
log.Information("trip {TripId} completed with fare {Fare:.2f}", "T-58201", 18.4)
```

The bulk request captured by a stub Elasticsearch node:

```txt
POST /dispatch-logs/_bulk
{"index":{}}
{"Fare":18.4,"TripId":"T-58201","ecs.version":"8.11.0","log.level":"info","message":"trip T-58201 completed with fare 18.40","message_template.text":"trip {TripId} completed with fare {Fare:.2f}"}
```

`Config` fields: `Addresses` (round-robin), `Index`, `Username`/`Password` or `APIKey`, `BatchSize` (500), `FlushInterval` (5s), `QueueSize` (10000), `MaxRetries` (3, 4xx never retried), `Timeout` (30s), `OnError`, `Client` (custom `*http.Client`). `Sink.Dropped()` and `Sink.Failed()` expose counters. You can also build the sink with `srogelastic.New(cfg)` and wire it yourself via `srog.WithWriter(sink, srog.AsECS())`.

## OTLP/JSON output

The `AsOTel()` sink format emits each event as one OpenTelemetry `LogRecord` in OTLP/JSON (NDJSON, one record per line) — the representation the OpenTelemetry Collector's `otlpjson` receiver understands, feeding any OTel logs pipeline (Collector → Loki/Elastic/...).

| zerolog field | OTLP field |
| --- | --- |
| `time` | `timeUnixNano` + `observedTimeUnixNano` |
| `level` | `severityNumber` + `severityText` |
| `message` | `body.stringValue` |
| `trace_id` / `span_id` | `traceId` / `spanId` (promoted out of attributes) |
| `error` | attribute `exception.message` |
| `stack` | attribute `exception.stacktrace` |
| `caller` | attributes `code.filepath` + `code.lineno` |
| `@mt` | attribute `log.template` |
| everything else | attributes with typed OTLP `AnyValue`s |

Captured:

```json
{"attributes":[{"key":"Kwh","value":{"doubleValue":14.267}},{"key":"MeterId","value":{"stringValue":"M-3312"}},{"key":"log.template","value":{"stringValue":"meter {MeterId} reported {Kwh:.2f} kWh"}}],"body":{"stringValue":"meter M-3312 reported 14.27 kWh"},"observedTimeUnixNano":"1783932967000000000","severityNumber":9,"severityText":"INFO","timeUnixNano":"1783932967000000000"}
```

Severity mapping: trace→1/TRACE, debug→5/DEBUG, info→9/INFO, warn→13/WARN, error→17/ERROR, fatal→21/FATAL. Integers are emitted as decimal strings under `intValue` per the proto3 JSON mapping; attributes are sorted by key for stable output.

## OpenTelemetry correlation (srogotel)

`go get github.com/dvislobokov/srog/srogotel`

A one-line bridge that registers a [context field extractor](./context.md#context-field-extractors) pulling the active span's IDs, so context-scoped logs correlate with traces in Kibana/Jaeger/Tempo:

```go
func main() {
	srogotel.Install() // once at startup
	// ...
}

func handler(ctx context.Context) {
	srog.InfoCtx(ctx, "trip {TripId} assigned", "T-58201") // carries trace_id, span_id
}
```

Captured with a real SDK span active:

```json
{"level":"info","trace_id":"7a32e3b7222cef22b21a776beaf05c2d","span_id":"ffa2cea413d07212","@mt":"trip {TripId} assigned","TripId":"T-58201","message":"trip T-58201 assigned"}
```

`srogotel.Fields` is the underlying `srog.ContextFieldFunc` if you prefer to register it yourself. When these fields are present, the `AsOTel()` format promotes them to the record's `traceId`/`spanId`.
