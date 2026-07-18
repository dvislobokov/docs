# shost

shost is a hosting framework for Go, inspired by `Microsoft.Extensions.Hosting`. It removes the `main()` boilerplate of long-running services — signal handling, ordered startup, graceful shutdown with a deadline, panic recovery, and restart supervision — while keeping dependency wiring explicit and idiomatic. There is no DI container.

## Why shost

- **A real service lifecycle.** Register services that implement `Start(ctx)` / `Stop(ctx)`; the host starts them in order, and on SIGINT/SIGTERM stops them in reverse under a shared deadline. A stuck service is reported and abandoned rather than hanging the process.
- **Graceful shutdown that actually bounds.** `WithShutdownTimeout` (default 30s) caps the entire teardown; `Stop(ctx)` receives the remaining deadline.
- **Restart supervision.** `WithRestart` gives a service exponential-backoff restarts with an attempt cap and a stability reset — no external supervisor needed.
- **Readiness gating.** A service can implement `Readier`; the host waits for it to become ready before launching the next one, bounded by `WithStartTimeout`.
- **Startup tasks.** `AddStartupTask` runs one-shot work (migrations, cache warmup) sequentially before any service starts; a failure aborts the host.
- **Lifecycle hooks.** `OnStarted` / `OnStopping` / `OnStopped` / `OnReload` — the analog of `IHostApplicationLifetime`, plus SIGHUP-triggered reload on Unix.
- **Panic-safe.** Panics in `Start`, `Stop`, hooks, and observers are recovered, logged with a stack trace, and treated as errors.
- **Standard library only.** The core module and the `httpsvc`, `cron`, `health`, `shosttest`, `sdnotify`, and `single` subpackages have no external dependencies. Logging is optional and interface-based — srog satisfies it directly, and `SlogLogger` adapts `log/slog`.
- **gRPC out of the box.** Separate `grpcsvc` and `grpcgw` modules run a gRPC server and a grpc-gateway REST frontend as supervised services.
- **Daemon-ready.** systemd `Type=notify` integration with watchdog (`sdnotify`), a Windows service bridge with SCM handshake and Event Log (`winsvc`), and a machine-wide single-instance lock (`single`).
- **Testable.** `shosttest` runs a real host inside a test and records lifecycle events for assertions.
- **Observability without coupling.** Lifecycle events are exposed through an `Observer` struct of callbacks; a separate `otel` module maps them to OpenTelemetry metrics and spans.

Part of the `s*` family alongside [sconf](/sconf/) (configuration), [sorm](/sorm/) (ORM), and [srog](/srog/) (logging).

## Installation

```sh
go get github.com/dvislobokov/shost
```

The core module requires only Go 1.22 or newer. Four integrations with heavier dependencies live in their own modules (these require Go 1.25+):

```sh
go get github.com/dvislobokov/shost/otel     # OpenTelemetry metrics + spans
go get github.com/dvislobokov/shost/grpcsvc  # gRPC server as a Service
go get github.com/dvislobokov/shost/grpcgw   # grpc-gateway as a Service
go get github.com/dvislobokov/shost/winsvc   # Windows service bridge
```

## A minimal example

```go
package main

import (
	"context"
	"os"
	"time"

	"github.com/dvislobokov/shost"
	"github.com/dvislobokov/srog"
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
	log := srog.MustNew(srog.WithConsole())
	defer log.Close()

	host := shost.New().
		WithLogger(log). // *srog.Logger satisfies shost.Logger directly
		WithShutdownTimeout(30 * time.Second).
		AddService(&Worker{}, shost.WithRestart(shost.RestartPolicy{MaxAttempts: 5})).
		OnStarted(func() { log.Information("app is up") }).
		MustBuild()

	if err := host.Run(); err != nil {
		os.Exit(1)
	}
}
```

`host.Run()` blocks until SIGINT/SIGTERM (or `host.Shutdown()`), then stops all services in reverse registration order within the shutdown timeout.

## Package layout

| Package | Contents |
|---|---|
| `shost` | `Builder`, `Host`, `Service`/`Readier`/`Logger` interfaces, startup tasks, `RestartPolicy`, `Environment`, `Observer`, `SlogLogger` |
| `shost/httpsvc` | a `net/http` server as a `Service`, with readiness and drained shutdown |
| `shost/cron` | periodic jobs as services — fixed intervals and cron expressions (non-overlapping) |
| `shost/health` | a `Checker` registry with `/healthz` and `/readyz` handlers (paths overridable) |
| `shost/swaggerui` | bundled Swagger UI as a plain `http.Handler` — embedded assets, works offline |
| `shost/shosttest` | run a real host in tests; record lifecycle events for assertions |
| `shost/sdnotify` | systemd `Type=notify` integration: readiness, stopping, watchdog, unit generation |
| `shost/single` | machine-wide single-instance lock, released by the OS on crash |
| `shost/otel` | maps lifecycle events to OpenTelemetry metrics + spans (separate module) |
| `shost/grpcsvc` | a gRPC server as a `Service` (separate module) |
| `shost/grpcgw` | a grpc-gateway REST frontend as a `Service` (separate module) |
| `shost/winsvc` | run the host as a Windows service: SCM handshake, Event Log, Install/Uninstall (separate module) |

Runnable integration examples live in the repository's `examples/` directory (standalone Echo and Gin services).

## Where to go next

- [Quick start](./quick-start.md) — an HTTP service with health checks and a background worker.
- [Services and lifecycle](./services.md) — the contract, startup tasks, startup/shutdown ordering, failures, hooks, and reload.
- [Restart policies](./restart-policies.md) — supervision and backoff.
- [HTTP services](./http.md) — `httpsvc`.
- [gRPC and grpc-gateway](./grpc.md) — `grpcsvc` and `grpcgw`.
- [Cron jobs](./cron.md) — periodic work, intervals and cron expressions.
- [Health checks](./health.md) — Kubernetes probes wired to the lifecycle.
- [Environments](./environments.md) — `Environment` and layering config with sconf.
- [Running as a daemon](./daemons.md) — systemd, Windows services, single-instance locks.
- [Observability](./observability.md) — the `Observer` and the OpenTelemetry module.
- [Testing](./testing.md) — `shosttest`.
- [API reference](./api.md) — every exported symbol.

Source: [github.com/dvislobokov/shost](https://github.com/dvislobokov/shost)
