# Cron jobs

`shost/cron` runs periodic work as a timed shost `Service`. Runs never overlap, and by default a failed run is logged and the schedule continues.

```go
import "github.com/dvislobokov/shost/cron"

host := shost.New().
	AddService(cron.Every("cleanup", time.Hour, cleanup, cron.RunImmediately())).
	MustBuild()

func cleanup(ctx context.Context) error {
	// ctx is canceled on shutdown
	return nil
}
```

## API

```go
type Job func(ctx context.Context) error

func Every(name string, interval time.Duration, job Job, opts ...Option) *Service

func RunImmediately() Option                 // run once at startup, before the first tick
func StopOnError() Option                    // a failed run stops the service (default: continue)
func WithErrorHandler(fn func(error)) Option // receives run errors and recovered panics
```

`Every` panics on an empty name, a non-positive interval, or a nil job — these are programmer errors, caught at construction.

## Semantics

- **Non-overlapping.** If a run is still in progress when the next tick fires, that tick is dropped; the next run happens on the following tick after the current one finishes.
- **Errors continue by default.** A job returning an error (or panicking — panics are recovered) is passed to `WithErrorHandler` and the schedule keeps going. Add `StopOnError()` to make a failed run stop the service instead.
- **Shutdown.** The job's `ctx` is canceled on shutdown; a run in progress should observe it and return.

```go
cron.Every("reindex", 5*time.Minute, reindex,
	cron.WithErrorHandler(func(err error) {
		log.Error(err, "reindex failed")
	}),
)
```

## Combined with restart

`cron` handles job-level errors; if you want the *service itself* supervised (e.g. it should be restarted if it somehow exits), it composes with a [restart policy](./restart-policies.md) like any other service — though for periodic work `WithErrorHandler` + the default continue-on-error behavior is usually what you want.
