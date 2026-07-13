# shost

shost is a hosting framework for Go, inspired by `Microsoft.Extensions.Hosting`. It removes the `main()` boilerplate of long-running services — signal handling, ordered startup, graceful shutdown with a deadline, panic recovery, and restart supervision — while keeping dependency wiring explicit and idiomatic. There is no DI container.

## Why shost

- **A real service lifecycle.** Register services that implement `Start(ctx)` / `Stop(ctx)`; the host starts them in order, and on SIGINT/SIGTERM stops them in reverse under a shared deadline. A stuck service is reported and abandoned rather than hanging the process.
- **Graceful shutdown that actually bounds.** `WithShutdownTimeout` (default 30s) caps the entire teardown; `Stop(ctx)` receives the remaining deadline.
- **Restart supervision.** `WithRestart` gives a service exponential-backoff restarts with an attempt cap and a stability reset — no external supervisor needed.
- **Readiness gating.** A service can implement `Readier`; the host waits for it to become ready before launching the next one, bounded by `WithStartTimeout`.
- **Lifecycle hooks.** `OnStarted` / `OnStopping` / `OnStopped` — the analog of `IHostApplicationLifetime`.
- **Panic-safe.** Panics in `Start`, `Stop`, hooks, and observers are recovered, logged with a stack trace, and treated as errors.
- **Standard library only.** The core module and the `httpsvc`, `cron`, and `health` subpackages have no external dependencies. Logging is optional and interface-based (srog-compatible).
- **Observability without coupling.** Lifecycle events are exposed through an `Observer` struct of callbacks; a separate `otel` module maps them to OpenTelemetry metrics and spans.

Part of the `s*` family alongside [sconf](/sconf/) (configuration), [sorm](/sorm/) (ORM), and [srog](/srog/) (logging).

## Installation

```sh
go get github.com/dvislobokov/shost
```

Requires Go 1.24 or newer. The OpenTelemetry integration is a separate module: `go get github.com/dvislobokov/shost/otel`.

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
| `shost` | `Builder`, `Host`, `Service`/`Readier`/`Logger` interfaces, `RestartPolicy`, `Environment`, `Observer` |
| `shost/httpsvc` | a `net/http` server as a `Service`, with readiness and drained shutdown |
| `shost/cron` | periodic jobs as timed services (non-overlapping) |
| `shost/health` | a `Checker` registry with `/healthz` and `/readyz` handlers |
| `shost/otel` | maps lifecycle events to OpenTelemetry metrics + spans (separate module) |

## Where to go next

- [Quick start](./quick-start.md) — an HTTP service with health checks and a background worker.
- [Services and lifecycle](./services.md) — the contract, startup/shutdown ordering, failures, and hooks.
- [Restart policies](./restart-policies.md) — supervision and backoff.
- [HTTP services](./http.md) — `httpsvc`.
- [Cron jobs](./cron.md) — periodic work.
- [Health checks](./health.md) — Kubernetes probes wired to the lifecycle.
- [Environments](./environments.md) — `Environment` and layering config with sconf.
- [Observability](./observability.md) — the `Observer` and the OpenTelemetry module.
- [API reference](./api.md) — every exported symbol.

Source: [github.com/dvislobokov/shost](https://github.com/dvislobokov/shost)
