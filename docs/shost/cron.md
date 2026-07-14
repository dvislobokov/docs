# Cron jobs

`shost/cron` runs periodic work as a shost `Service` — on a fixed interval (`Every`) or a standard cron expression (`At`). Runs never overlap, and by default a failed run is logged and the schedule continues.

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
func At(name string, schedule Schedule, job Job, opts ...Option) *Service

func RunImmediately() Option                 // run once at startup, before the first tick
func StopOnError() Option                    // a failed run stops the service (default: continue)
func WithErrorHandler(fn func(error)) Option // receives run errors and recovered panics
func WithJitter(d time.Duration) Option      // delay each run by a random amount in [0, d)
func WithRunTimeout(d time.Duration) Option  // bound each run with context.WithTimeout
```

`Every` panics on an empty name, a non-positive interval, or a nil job; `At` panics on an empty name, a nil schedule, or a nil job — these are programmer errors, caught at construction. `WithJitter` panics on a negative duration, `WithRunTimeout` on a non-positive one.

## Cron expressions

`At` runs the job on a `Schedule`; `Expr`/`MustExpr` build one from a standard 5-field cron expression:

```go
type Schedule interface {
	Next(after time.Time) time.Time
}
type ScheduleFunc func(after time.Time) time.Time // adapter, like http.HandlerFunc

func Expr(spec string) (Schedule, error)
func MustExpr(spec string) Schedule // panics on a malformed expression
```

```go
host := shost.New().
	AddService(cron.At("backup", cron.MustExpr("0 3 * * *"), backupJob,
		cron.WithErrorHandler(func(err error) { log.Error(err, "backup failed") }))).
	MustBuild()
```

Expression syntax — the classic five fields, standard library only:

| Field | Values |
| --- | --- |
| minute | 0–59 |
| hour | 0–23 |
| day of month | 1–31 |
| month | 1–12 or `jan`–`dec` |
| day of week | 0–6 or `sun`–`sat` (`7` = Sunday) |

Wildcards `*`, lists `1,15`, ranges `9-17`, steps `*/5` and `9-17/2` are all supported, as are the aliases `@hourly`, `@daily`/`@midnight`, `@weekly`, `@monthly`, `@yearly`/`@annually`. The classic cron OR rule applies: when both day-of-month and day-of-week are restricted, the job runs when **either** matches.

Details worth knowing:

- Times are evaluated in the location of the time passed to `Next` — host local time when used with `At`.
- A schedule that will never fire again returns the zero time from `Next`; `At` then parks the service until shutdown rather than exiting (which would stop the host). `Expr` bounds its internal search at 5 years, so an impossible spec like `0 0 30 2 *` resolves to "never" instead of looping forever.
- Custom schedules are one function away: any `ScheduleFunc` works with `At`.

## Run options: jitter and timeout

Both work with `Every` and `At`:

- `WithJitter(d)` delays each run by a random duration in `[0, d)` — useful to spread simultaneous runs across many instances of the same service. The jitter wait respects shutdown cancellation.
- `WithRunTimeout(d)` wraps the job's context in `context.WithTimeout`; a run exceeding it fails with `context.DeadlineExceeded` and flows into `WithErrorHandler` / `StopOnError` like any other error.

## Semantics

- **Non-overlapping.** With `Every`, if a run is still in progress when the next tick fires, that tick is dropped; the next run happens on the following tick after the current one finishes. With `At`, the next run time is computed **after** the previous run completes, so scheduled times that passed mid-run are skipped.
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
