# Services and lifecycle

## The Service contract

A service is anything that satisfies:

```go
type Service interface {
	Name() string
	Start(ctx context.Context) error
	Stop(ctx context.Context) error
}
```

- **`Start(ctx)` blocks** for the lifetime of the service and returns after `ctx` is canceled. Returning `ctx.Err()` on cancellation is the idiomatic graceful exit.
- **`Stop(ctx)`** performs graceful shutdown; its `ctx` carries the shared shutdown deadline.
- **`Name()`** must be unique across the host (duplicates are a build error).

For a simple blocking loop with no separate stop logic, use the adapter:

```go
shost.ServiceFunc("poller", func(ctx context.Context) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-tick:
			// ...
		}
	}
})
```

`ServiceFunc`'s `Stop` is a no-op — canceling the `Start` context is the only stop signal.

## Startup

Services start in **registration order**. If a service implements `Readier`:

```go
type Readier interface {
	Ready() <-chan struct{}
}
```

the host waits for that channel to close before launching the next service. The **total** readiness wait is bounded by `WithStartTimeout` (if set; otherwise the host waits indefinitely). `httpsvc` uses this to signal "listener is accepting."

## Shutdown

Triggered by SIGINT/SIGTERM (`Run`), a caller-cancelled context (`RunContext`), or `host.Shutdown()`. Shutdown proceeds in **reverse** registration order: each service's `Start` context is canceled, `Stop(ctx)` is called, and the host waits for `Start` to return — all bounded by `WithShutdownTimeout` (default `DefaultShutdownTimeout`, 30s). A service that doesn't return in time is reported and abandoned so it can't hang the process.

```go
host := shost.New().
	WithShutdownTimeout(45 * time.Second).
	WithStartTimeout(10 * time.Second).
	AddService(a).
	AddService(b). // starts after a is ready; stops before a
	MustBuild()
```

## Failure

If a service returns from `Start` **before** shutdown — with or without an error — the whole host stops. `Run`/`RunContext` then return a non-nil error (a joined error naming the service). This is how a fatal dependency takes the process down deterministically.

A service under a [restart policy](./restart-policies.md) is the exception: premature exits trigger restarts instead of stopping the host, until the policy is exhausted.

## Panics

Panics in `Start`, `Stop`, lifecycle hooks, and observers are recovered, logged with a stack trace, and treated as errors — a panicking service fails like an erroring one rather than crashing the process.

## Lifecycle hooks

The analog of `IHostApplicationLifetime`:

```go
shost.New().
	OnStarted(func()  { /* all services launched and ready */ }).
	OnStopping(func() { /* shutdown has begun */ }).
	OnStopped(func()  { /* everything stopped */ })
```

Hooks run synchronously; panics in them are recovered and logged. A common use is flipping [health](./health.md) readiness on `OnStarted` / `OnStopping`.

## Running

```go
func (h *Host) Run() error                            // installs SIGINT/SIGTERM handling, blocks
func (h *Host) RunContext(ctx context.Context) error  // your own shutdown trigger, no OS signals
func (h *Host) Shutdown()                              // idempotent, non-blocking, goroutine-safe
func (h *Host) Environment() Environment
```

Use `RunContext` when something else owns signal handling (tests, embedding). Both return `nil` on a clean shutdown and a joined error otherwise.

## Logging

Logging is optional and interface-based:

```go
type Logger interface {
	Debug(template string, args ...any)
	Information(template string, args ...any)
	Warning(template string, args ...any)
	Error(err error, template string, args ...any)
}
```

The interface is signature-compatible with [srog](/srog/), so `*srog.Logger` satisfies it directly via `WithLogger`. Without a logger the host is silent, but errors are still returned from `Run`.
