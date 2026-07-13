# Quick start

This builds a service that runs an HTTP API, a periodic cleanup job, and Kubernetes health endpoints — all supervised by shost.

## 1. Install

```sh
go get github.com/dvislobokov/shost
```

## 2. Compose the host

```go
package main

import (
	"context"
	"net/http"
	"os"
	"time"

	"github.com/dvislobokov/shost"
	"github.com/dvislobokov/shost/cron"
	"github.com/dvislobokov/shost/health"
	"github.com/dvislobokov/shost/httpsvc"
)

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/hello", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("hello"))
	})

	// Health checks exposed at /healthz and /readyz.
	reg := health.NewRegistry(
		health.CheckerFunc("db", func(ctx context.Context) error { return nil }),
	)
	reg.Mount(mux)

	host := shost.New().
		WithShutdownTimeout(20 * time.Second).
		// HTTP server: ready once it accepts, drained on shutdown.
		AddService(httpsvc.New(":8080", mux, httpsvc.WithName("api"))).
		// Periodic job: never overlaps; errors are logged and the schedule continues.
		AddService(cron.Every("cleanup", time.Hour, func(ctx context.Context) error {
			// ... clean things up ...
			return nil
		}, cron.RunImmediately())).
		// Flip readiness with the lifecycle.
		OnStarted(func() { reg.SetReady(true) }).
		OnStopping(func() { reg.SetReady(false) }).
		MustBuild()

	if err := host.Run(); err != nil {
		os.Exit(1)
	}
}
```

## 3. Run it

```sh
go run .
```

- `GET /hello` → `hello`
- `GET /healthz` → `200` while all checks pass (liveness)
- `GET /readyz` → `200` only after `OnStarted` flips readiness (readiness)

Press `Ctrl+C`: the host cancels each service in reverse order, `httpsvc` stops accepting and drains in-flight requests, and everything shuts down within the 20-second deadline.

## 4. Add a supervised worker

A background worker that should be restarted on premature exit:

```go
type worker struct{}

func (worker) Name() string { return "queue-worker" }
func (worker) Start(ctx context.Context) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
			// pull from a queue, process...
		}
	}
}
func (worker) Stop(ctx context.Context) error { return nil }

// register with a restart policy
host := shost.New().
	AddService(worker{}, shost.WithRestart(shost.RestartPolicy{
		MaxAttempts:  5,
		InitialDelay: time.Second,
		MaxDelay:     30 * time.Second,
	})).
	MustBuild()
```

If `Start` returns before shutdown, the host restarts it with exponential backoff up to `MaxAttempts`. See [Restart policies](./restart-policies.md).

## Where to go next

- [Services and lifecycle](./services.md) — the exact ordering and failure semantics.
- [Observability](./observability.md) — export lifecycle metrics to Prometheus/OpenTelemetry.
