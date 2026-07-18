# Examples

A cookbook of complete, copy-paste-ready recipes for every part of shost. Each example shows the code, the observable behavior, and — where it matters — the exact ordering of events. For the underlying rules, follow the links into the reference pages.

[[toc]]

## 1. The smallest possible host

One service, one host, graceful shutdown for free.

```go
package main

import (
	"context"
	"os"
	"time"

	"github.com/dvislobokov/shost"
)

type Worker struct{}

func (w *Worker) Name() string { return "worker" }

func (w *Worker) Start(ctx context.Context) error {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err() // graceful exit
		case <-ticker.C:
			// do work
		}
	}
}

func (w *Worker) Stop(ctx context.Context) error {
	// flush buffers, close connections; ctx carries the shutdown deadline
	return nil
}

func main() {
	host := shost.New().
		AddService(&Worker{}).
		MustBuild()

	if err := host.Run(); err != nil {
		os.Exit(1)
	}
}
```

`host.Run()` blocks until SIGINT/SIGTERM (or `host.Shutdown()`), then cancels the worker's `Start` context, calls `Stop`, and waits — all within the default 30-second shutdown deadline. See [Services and lifecycle](./services.md).

## 2. Lifecycle order and readiness

Services start in **registration order** and stop in **reverse**. A service implementing `Readier` gates the next one: it isn't launched until the channel closes.

```go
host := shost.New().
	WithStartTimeout(10 * time.Second). // total readiness wait; unset => wait forever
	AddService(httpsvc.New(":8080", mux)).      // 1st: ready once listening
	AddService(shost.ServiceFunc("announcer",   // 2nd: starts only after the server accepts
		func(ctx context.Context) error {
			registerInServiceDiscovery()
			<-ctx.Done()
			deregister()
			return ctx.Err()
		})).
	OnStarted(func()  { /* everything launched and ready */ }).
	OnStopping(func() { /* shutdown began, nothing stopped yet */ }).
	OnStopped(func()  { /* everything stopped */ }).
	MustBuild()
```

Timeline on `Ctrl+C`:

| Step | What happens |
|---|---|
| 1 | `OnStopping` hooks run |
| 2 | `announcer` (last registered) is canceled and stopped |
| 3 | `httpsvc` stops accepting, drains in-flight requests |
| 4 | `OnStopped` hooks run, `Run` returns `nil` |

`ServiceFunc` adapts a blocking function into a `Service` with a no-op `Stop` — cancellation is the only stop signal. See [Services and lifecycle](./services.md).

## 3. Startup tasks: migrate before serving

One-shot work that must finish before *any* service starts — migrations, cache warmup, sanity checks:

```go
host := shost.New().
	AddStartupTask("migrate", func(ctx context.Context) error {
		return db.MigrateUp(ctx) // ctx is canceled by a signal or Shutdown()
	}).
	AddStartupTask("warm-cache", warmCache).
	AddService(httpsvc.New(":8080", mux)).
	MustBuild()
```

- Tasks run **sequentially in registration order**, before any service.
- A task error (or panic — panics are recovered) aborts the host: services never start and `Run` returns `shost: startup task migrate: <err>`.
- `Ctrl+C` mid-tasks is a *clean* exit: remaining tasks are skipped and `Run` returns `nil`.

## 4. Graceful shutdown that actually bounds

`WithShutdownTimeout` caps the **entire** teardown; each `Stop(ctx)` receives the remaining deadline. A service that never returns is reported and abandoned — it cannot hang the process.

```go
host := shost.New().
	WithShutdownTimeout(45 * time.Second). // default DefaultShutdownTimeout (30s)
	AddService(a).
	AddService(b). // stops before a
	MustBuild()

host.ShutdownTimeout() // 45s — useful to align with systemd TimeoutStopSec, K8s terminationGracePeriodSeconds
```

To drive shutdown yourself instead of OS signals, use `RunContext`:

```go
ctx, cancel := context.WithCancel(context.Background())
go func() { <-someCondition; cancel() }()

err := host.RunContext(ctx) // no signal handlers installed; cancel triggers shutdown
```

Or from any goroutine, at any time: `host.Shutdown()` — idempotent and non-blocking.

::: tip
Give the pod/unit *more* time than the host: `terminationGracePeriodSeconds` and `TimeoutStopSec` should exceed `WithShutdownTimeout`, so the host finishes its own drain before the supervisor kills the process.
:::

## 5. Supervising a flaky worker: restart policies

By default a service that returns from `Start` before shutdown — with or without an error — **stops the whole host** (deterministic fail-fast). `WithRestart` turns that into supervision with exponential backoff:

```go
host := shost.New().
	AddService(&queueWorker{}, shost.WithRestart(shost.RestartPolicy{
		MaxAttempts:  5,               // 0 = unlimited
		InitialDelay: time.Second,     // default 1s
		MaxDelay:     30 * time.Second, // default 1m
		Factor:       2.0,             // default 2.0
		ResetAfter:   time.Minute,     // stable run resets the counter; default 1m
	})).
	MustBuild()
```

Restart delays: `1s, 2s, 4s, 8s, 16s` (capped at `MaxDelay`). After the worker runs stably for `ResetAfter`, the attempt counter resets — a once-a-day crash never exhausts the budget. Exhausting `MaxAttempts` stops the host with an error naming the service.

An invalid policy (negative fields, `Factor < 1`, `MaxDelay < InitialDelay`) fails at `Build`, not at runtime. See [Restart policies](./restart-policies.md).

## 6. An HTTP API with middleware and drained shutdown

`httpsvc` wraps any `http.Handler`; middleware is ordinary handler wrapping:

```go
func logging(log shost.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Information("{Method} {Path} in {Elapsed}", r.Method, r.URL.Path, time.Since(start))
	})
}

mux := http.NewServeMux()
mux.HandleFunc("GET /orders/{id}", getOrder)
mux.HandleFunc("POST /orders", createOrder)

host := shost.New().
	WithLogger(log).
	AddService(httpsvc.New(":8080", logging(log, mux), httpsvc.WithName("api"))).
	MustBuild()
```

On shutdown the service calls `http.Server.Shutdown` with the host's deadline context — in-flight requests finish; if the deadline expires first, it falls back to a forceful `Close` and `Stop` returns a "graceful shutdown timed out" error. See [HTTP services](./http.md).

## 7. HTTP tuning: server timeouts and port `:0`

`WithServer` hands you the underlying `*http.Server` before it starts:

```go
svc := httpsvc.New(":8080", mux,
	httpsvc.WithName("api"),
	httpsvc.WithServer(func(s *http.Server) {
		s.ReadHeaderTimeout = 5 * time.Second
		s.IdleTimeout = 60 * time.Second
		s.ErrorLog = stdlog.New(io.Discard, "", 0) // silence TLS-probe noise
	}))
```

Bind to `:0` to get an OS-assigned port and read it back once ready — the pattern tests are built on:

```go
svc := httpsvc.New(":0", mux)
host := shost.New().AddService(svc).MustBuild()
go host.Run()

<-svc.Ready()            // closes once the listener accepts
base := "http://" + svc.Addr() // e.g. http://127.0.0.1:52814 ("" before ready)
```

## 8. A framework router (Gin) as the handler

Echo, Gin, chi — anything implementing `http.Handler` plugs straight into `httpsvc`. From the repository's `examples/gin`:

```go
gin.SetMode(gin.ReleaseMode)
r := gin.New()
r.Use(gin.Recovery())
r.GET("/hello", func(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"message": "hello from gin + shost"})
})

reg := health.NewRegistry()
r.GET("/healthz", gin.WrapH(reg.LiveHandler())) // health as regular gin routes
r.GET("/readyz", gin.WrapH(reg.ReadyHandler()))

host := shost.New().
	WithLogger(log).
	WithShutdownTimeout(15*time.Second).
	AddService(httpsvc.New(":8080", r, httpsvc.WithName("gin-api"))).
	AddService(&queueWorker{}, shost.WithRestart(shost.RestartPolicy{MaxAttempts: 5})).
	OnStarted(func() { reg.SetReady(true) }).
	OnStopping(func() { reg.SetReady(false) }).
	MustBuild()
```

## 9. Kubernetes health probes wired to the lifecycle

`health` gives you a checker registry with `/healthz` (liveness) and `/readyz` (readiness); the readiness flag is flipped from lifecycle hooks:

```go
reg := health.NewRegistry(
	health.CheckerFunc("db", func(ctx context.Context) error { return db.PingContext(ctx) }),
	health.CheckerFunc("cache", cache.Ping),
)
reg.Mount(mux) // registers /healthz and /readyz

host := shost.New().
	AddService(httpsvc.New(":8080", mux)).
	OnStarted(func()  { reg.SetReady(true) }).  // pod starts receiving traffic
	OnStopping(func() { reg.SetReady(false) }). // traffic stops before the drain
	MustBuild()
```

| Endpoint | Returns 200 when | Kubernetes reaction on failure |
|---|---|---|
| `/healthz` | every check passes | restarts the pod |
| `/readyz` | readiness flag set **and** every check passes | stops routing traffic |

The registry starts **not ready**, so no traffic arrives before `OnStarted`. Both handlers return JSON, e.g. `{ "status": "unhealthy", "checks": { "db": "connection refused", "cache": "ok" } }`. See [Health checks](./health.md).

## 10. Periodic jobs: fixed intervals

`cron.Every` runs a job on a fixed interval as a supervised service. Runs never overlap; a busy tick is dropped.

```go
import "github.com/dvislobokov/shost/cron"

host := shost.New().
	AddService(cron.Every("cleanup", time.Hour, func(ctx context.Context) error {
		return deleteExpiredSessions(ctx) // ctx is canceled on shutdown
	}, cron.RunImmediately())). // one run at startup, before the first tick
	AddService(cron.Every("reindex", 5*time.Minute, reindex,
		cron.WithErrorHandler(func(err error) { log.Error(err, "reindex failed") }))).
	MustBuild()
```

By default a failed run (or a panic — recovered) is passed to `WithErrorHandler` and the schedule continues; add `cron.StopOnError()` to make a failure stop the service instead. See [Cron jobs](./cron.md).

## 11. Cron expressions, jitter, and per-run timeouts

`cron.At` takes a `Schedule`; `MustExpr` builds one from a classic 5-field expression (aliases like `@daily` work too):

```go
host := shost.New().
	// nightly backup at 03:00 host-local time
	AddService(cron.At("backup", cron.MustExpr("0 3 * * *"), backupJob,
		cron.WithRunTimeout(30*time.Minute), // a run exceeding this fails with DeadlineExceeded
		cron.WithErrorHandler(func(err error) { log.Error(err, "backup failed") }))).
	// business hours, every 2 hours, weekdays only
	AddService(cron.At("report", cron.MustExpr("0 9-17/2 * * mon-fri"), report,
		cron.WithJitter(30*time.Second))). // spread N replicas' runs across [0, 30s)
	MustBuild()
```

A custom schedule is one function away:

```go
cron.At("odd-hours", cron.ScheduleFunc(func(after time.Time) time.Time {
	next := after.Truncate(time.Hour).Add(time.Hour)
	if next.Hour()%2 == 0 {
		next = next.Add(time.Hour)
	}
	return next
}), job)
```

With `At`, the next run time is computed **after** the previous run completes — scheduled times that passed mid-run are skipped, never queued.

## 12. A gRPC server

`grpcsvc` (separate module) runs a `*grpc.Server` with the full lifecycle — readiness once the listener accepts, `GracefulStop` under the shared deadline, forceful stop when it expires:

```go
import (
	"google.golang.org/grpc"
	"github.com/dvislobokov/shost/grpcsvc"
)

srv := grpc.NewServer()
pb.RegisterGreeterServer(srv, &greeter{}) // register BEFORE passing srv in

host := shost.New().
	WithShutdownTimeout(20 * time.Second).
	AddService(grpcsvc.New(":9090", srv, grpcsvc.WithName("grpc"))).
	MustBuild()
```

If in-flight RPCs don't drain within the deadline, `Stop` stops the server forcefully and returns a "graceful shutdown timed out" error wrapping `ctx.Err()`. See [gRPC and grpc-gateway](./grpc.md).

## 13. A REST frontend with grpc-gateway

`grpcgw` owns the gateway boilerplate: the `runtime.ServeMux`, the client connection, handler registration, and the HTTP server lifecycle. Register the gateway **after** the gRPC server — readiness ordering gives you a fully wired pipeline:

```go
import "github.com/dvislobokov/shost/grpcgw"

gw := grpcgw.New(":8081", "localhost:9090",
	grpcgw.Register(pb.RegisterGreeterHandler), // protoc-generated; at least one required
	grpcgw.Register(pb.RegisterOrdersHandler),
	grpcgw.WithHandler(func(next http.Handler) http.Handler { // middleware: CORS, auth, logging
		return corsMiddleware(next)
	}))

host := shost.New().
	AddService(grpcsvc.New(":9090", grpcServer)).
	AddService(gw). // starts only after the gRPC server is ready
	MustBuild()
```

::: warning
The connection to the endpoint is **plaintext by default** — fine for the usual same-host gateway. `WithDialOptions` *replaces* the defaults, so supply your own transport credentials when the gRPC server is remote or TLS-terminated.
:::

## 14. Environments and config layering with sconf

`Environment` is the analog of ASP.NET Core's `IHostEnvironment`. Read it from `APP_ENVIRONMENT` (unset resolves to `Production`) and use it to select config layers with [sconf](/sconf/):

```go
env := shost.EnvironmentFromEnv("") // "" => DefaultEnvironmentVar (APP_ENVIRONMENT)

cfg, err := sconf.Load[Config](
	sconf.New().
		AddYAMLFile("appsettings.yaml").
		AddYAMLFile("appsettings."+env.String()+".yaml", sconf.Optional()).
		AddEnvironmentVariables("APP_"),
	os.Args[1:],
)
if err != nil {
	log.Fatal(err)
}

builder := shost.New().WithEnvironment(env)
if env.IsDevelopment() {
	builder.WithLogger(shost.SlogLogger(slog.New(
		slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelDebug}))))
}
host := builder.AddService(httpsvc.New(cfg.Listen, mux)).MustBuild()

host.Environment().IsProduction() // matching is case-insensitive; custom values allowed
```

`appsettings.Development.yaml` overrides the base only in development — the `appsettings.{Environment}.json` pattern. See [Environments](./environments.md).

## 15. Logging: srog and log/slog

The `Logger` interface is optional and signature-compatible with [srog](/srog/), so `*srog.Logger` passes straight in:

```go
log := srog.MustNew(srog.WithConsole())
defer log.Close()

host := shost.New().WithLogger(log). /* ... */ MustBuild()
```

For the standard library there is a built-in adapter:

```go
host := shost.New().
	WithLogger(shost.SlogLogger(slog.Default())). // panics on nil
	MustBuild()
```

`SlogLogger` renders srog-style `{Name}` templates into the message *and* adds each matched placeholder as a slog attribute (`Error` also appends an `error` attribute). Without any logger the host is silent — but errors are still returned from `Run`.

## 16. Hot reload without a restart

`OnReload` hooks run on `Host.Reload()`; on Unix, `Run()` also wires SIGHUP to it — the classic daemon convention:

```go
host := shost.New().
	OnReload(func() {
		reloadConfig()
		log.Information("config reloaded")
	}).
	MustBuild()

host.Run() // kill -HUP <pid> → Reload (Unix only; RunContext installs no signals)
```

`Reload` is safe from any goroutine; concurrent calls are serialized. Under a Windows service, the [winsvc module](./daemons.md#windows-service-winsvc) maps the SCM `PARAMCHANGE` control to the same hooks (`sc control my-agent paramchange`). See [Services and lifecycle](./services.md#reload).

## 17. Metrics: the Observer and OpenTelemetry

Lifecycle events flow through an `Observer` — a struct of optional callbacks; register several and they run in order:

```go
host := shost.New().
	WithObserver(shost.Observer{
		ServiceRestarting: func(name string, attempt int, delay time.Duration, err error) {
			log.Warning("restarting {Service} (attempt {Attempt}) in {Delay}", name, attempt, delay)
		},
		ServiceFailed: func(name string, err error) {
			alerting.Notify("service failed: " + name)
		},
	}).
	MustBuild()
```

The `otel` module (package `shostotel`, separate module) maps the events to OpenTelemetry; `NewPrometheusHandler` gives a ready `/metrics` endpoint:

```go
import shostotel "github.com/dvislobokov/shost/otel"

metricsHandler, provider, _ := shostotel.NewPrometheusHandler()
obs, _ := shostotel.NewObserver(shostotel.WithMeterProvider(provider))

mux.Handle("/metrics", metricsHandler)

host := shost.New().
	WithObserver(obs).
	OnStopped(func() { provider.Shutdown(context.Background()) }). // you own the provider
	AddService(httpsvc.New(":8080", mux)).
	MustBuild()
```

Out of the box: `shost.host.up` (gauge), `shost.service.restarts` and `shost.service.failures` (counters, per service), `shost.service.stop.duration` (histogram), and a `shost.service.stop` span — enough to alert on flapping services and slow shutdowns. See [Observability](./observability.md).

## 18. Running under systemd

`sdnotify.Bind` wires the sd_notify protocol into the lifecycle: `READY=1` on `OnStarted`, `STOPPING=1` on `OnStopping`, and a watchdog pinger when the unit sets `WatchdogSec=`. Everything is a **no-op when `NOTIFY_SOCKET` is unset**, so the same binary runs in a terminal or a container unchanged:

```go
import "github.com/dvislobokov/shost/sdnotify"

host := sdnotify.Bind(shost.New().
	WithShutdownTimeout(30 * time.Second).
	AddService(worker)).
	MustBuild()
host.Run()
```

`Unit` renders a matching `Type=notify` unit for installers:

```go
fmt.Print(sdnotify.Unit(sdnotify.UnitConfig{
	Description:    "My agent",
	ExecStart:      "/usr/local/bin/my-agent",
	User:           "myagent",
	WatchdogSec:    30 * time.Second, // pair with Bind, which starts the pinger
	TimeoutStopSec: 45 * time.Second, // ≥ WithShutdownTimeout, so systemd waits for the drain
}))
```

The generated unit includes `Restart=on-failure` — systemd restarts the *process*, while [`WithRestart`](./restart-policies.md) supervises individual services *inside* it. See [Running as a daemon](./daemons.md).

## 19. A Windows service with a single-instance lock

Under the Service Control Manager there are no signals — `winsvc.Run` (separate module) speaks the SCM protocol and falls back to plain `Host.Run` everywhere else, so one binary works as a service, in a container, and from a terminal:

```go
import (
	"github.com/dvislobokov/shost/single"
	"github.com/dvislobokov/shost/winsvc"
)

func main() {
	// one instance per machine; the OS releases the lock even on a crash
	lock, err := single.Acquire(single.DefaultPath("my-agent"))
	if errors.Is(err, single.ErrAlreadyRunning) {
		fmt.Fprintln(os.Stderr, "my-agent is already running")
		os.Exit(1)
	}
	defer lock.Release()

	b := shost.New().
		AddService(worker).
		OnReload(reloadConfig) // SCM PARAMCHANGE → Reload

	if err := winsvc.Run(b, winsvc.WithName("my-agent")); err != nil {
		os.Exit(1)
	}
}
```

Under SCM: `START_PENDING` while startup tasks and services come up, `RUNNING` on started, `STOP_PENDING` checkpoints while services drain (wait hint derived from `Host.ShutdownTimeout()`), errors to the Windows Event Log. Wire installation to CLI flags, run elevated:

```go
if os.Args[1] == "install" {
	exe, _ := os.Executable()
	err := winsvc.Install("my-agent", exe, winsvc.InstallConfig{
		DisplayName: "My Agent",
		Description: "Collects metrics",
	}) // also creates the Event Log source
}
// winsvc.Uninstall("my-agent") for the reverse
```

See [Running as a daemon](./daemons.md#windows-service-winsvc).

## 20. Testing a hosted service with shosttest

`shosttest` (core module, standard library only) runs a *real* host inside a test — `Start` blocks until every service is ready, and a `t.Cleanup` stops the host automatically:

```go
func TestAPI(t *testing.T) {
	svc := httpsvc.New(":0", mux) // OS-assigned port
	h := shosttest.Start(t, shost.New().AddService(svc))

	resp, err := http.Get("http://" + svc.Addr() + "/hello")
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("got %d", resp.StatusCode)
	}

	if err := h.Stop(); err != nil { // Shutdown + Wait; assert on Run's error
		t.Fatal(err)
	}
}
```

`Recorder` is a ready-made `Observer` for asserting on asynchronous lifecycle events:

```go
func TestFlakyWorkerRestarts(t *testing.T) {
	rec := shosttest.NewRecorder()
	shosttest.Start(t, shost.New().
		WithObserver(rec.Observer()).
		AddService(flaky, shost.WithRestart(shost.RestartPolicy{MaxAttempts: 3})))

	if !rec.WaitFor(shosttest.ServiceRestarting, "flaky", time.Second) {
		t.Fatal("expected a restart")
	}
	rec.Has(shosttest.ServiceFailed, "") // "" matches any service
}
```

Build errors, startup failures, and a startup hanging beyond `shosttest.DefaultTimeout` (10s) fail the test via `t.Fatalf`. See [Testing](./testing.md).

::: tip Error handling in one place
Builder mistakes (nil service, duplicate name, invalid restart policy, non-positive timeout) are **accumulated** and joined by `Build()` — `MustBuild()` panics with all of them at once, which is what you want in `main`. Runtime failures (a failing startup task, a service exiting prematurely, an exhausted restart policy) surface as a non-nil, joined error from `Run`/`RunContext` naming the culprit; the package exports no sentinel `Err…` values — messages are prefixed `shost:`. See the [API reference](./api.md).
:::
