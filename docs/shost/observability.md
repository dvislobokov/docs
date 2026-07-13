# Observability

The shost core exposes lifecycle events through an `Observer` — a struct of optional callbacks in the style of `httptrace.ClientTrace`. Any telemetry stack can hook in without adding dependencies to the core, and a separate module maps the events to OpenTelemetry.

## The Observer

```go
type Observer struct {
	HostStarted       func()
	HostStopped       func(err error)
	ServiceStarted    func(name string)
	ServiceReady      func(name string)
	ServiceRestarting func(name string, attempt int, delay time.Duration, err error)
	ServiceStopped    func(name string, elapsed time.Duration, err error)
	ServiceFailed     func(name string, err error)
}
```

Any field may be nil. Callbacks run synchronously from the host loop, and panics in them are recovered and logged. Register one (or several) with `WithObserver`:

```go
host := shost.New().
	WithObserver(shost.Observer{
		ServiceFailed: func(name string, err error) {
			metrics.Inc("service_failures", name)
		},
		ServiceRestarting: func(name string, attempt int, delay time.Duration, err error) {
			log.Warning("restarting {Service} (attempt {Attempt})", name, attempt)
		},
	}).
	AddService(worker{}, shost.WithRestart(shost.RestartPolicy{})).
	MustBuild()
```

Multiple observers run in registration order — compose an OpenTelemetry observer with your own ad-hoc one.

## OpenTelemetry module

`github.com/dvislobokov/shost/otel` (package `shostotel`) maps the observer events to OpenTelemetry metrics and spans. It's a separate module, so the core stays dependency-free.

```go
go get github.com/dvislobokov/shost/otel
```

```go
import shostotel "github.com/dvislobokov/shost/otel"

metricsHandler, provider, _ := shostotel.NewPrometheusHandler()
obs, _ := shostotel.NewObserver(shostotel.WithMeterProvider(provider))

mux.Handle("/metrics", metricsHandler)

host := shost.New().
	WithObserver(obs).
	OnStopped(func() { provider.Shutdown(context.Background()) }).
	AddService(httpsvc.New(":8080", mux)).
	MustBuild()
```

### API

```go
func NewObserver(opts ...Option) (shost.Observer, error)
func NewPrometheusHandler() (http.Handler, *sdkmetric.MeterProvider, error)

func WithMeterProvider(mp metric.MeterProvider) Option   // default: otel.GetMeterProvider()
func WithTracerProvider(tp trace.TracerProvider) Option  // default: otel.GetTracerProvider()
```

`NewObserver` returns a `shost.Observer` you pass to `WithObserver`. `NewPrometheusHandler` builds a dedicated registry, an OpenTelemetry Prometheus exporter, and a `MeterProvider`; you own the provider and should call `provider.Shutdown` (e.g. from `OnStopped`). To use your own OTLP pipeline instead, construct the observer with `WithMeterProvider`/`WithTracerProvider`.

### Emitted metrics and spans

Instrumentation scope: `github.com/dvislobokov/shost/otel`.

| Instrument | Type | Emitted on | Attributes |
|---|---|---|---|
| `shost.host.up` | Int64 gauge | `1` on host start, `0` on stop | — |
| `shost.service.restarts` | Int64 counter | each restart | `service` |
| `shost.service.failures` | Int64 counter | each failure | `service` |
| `shost.service.stop.duration` | Float64 histogram (s) | each service stop | `service` |
| `shost.service.stop` | span | per service shutdown (backdated by `elapsed`) | `service`; error status on failure |

That gives you host uptime, restart/failure counters per service, and shutdown-duration distributions and traces — enough to alert on flapping services and slow shutdowns out of the box.
