# Restart policies

By default, a service that returns from `Start` before shutdown stops the whole host. Wrapping it in a restart policy makes the host **supervise** it instead: premature exits trigger restarts with exponential backoff, and the host stops only when the policy is exhausted.

```go
host := shost.New().
	AddService(worker{}, shost.WithRestart(shost.RestartPolicy{
		MaxAttempts:  5,
		InitialDelay: time.Second,
		MaxDelay:     30 * time.Second,
		Factor:       2.0,
		ResetAfter:   time.Minute,
	})).
	MustBuild()
```

## RestartPolicy

```go
type RestartPolicy struct {
	MaxAttempts  int           // 0 = unlimited
	InitialDelay time.Duration
	MaxDelay     time.Duration
	Factor       float64
	ResetAfter   time.Duration
}
```

Zero-valued fields take sensible defaults:

| Field | Default | Meaning |
|---|---|---|
| `MaxAttempts` | `0` (unlimited) | how many restart attempts before the host gives up and stops |
| `InitialDelay` | `1s` | backoff before the first restart |
| `MaxDelay` | `1m` | ceiling on the backoff |
| `Factor` | `2.0` | multiplier applied to the delay each attempt |
| `ResetAfter` | `1m` | after this much stable run, the attempt counter resets to zero |

Constants: `DefaultRestartInitialDelay`, `DefaultRestartMaxDelay`, `DefaultRestartFactor`, `DefaultRestartResetAfter`.

## Behavior

- Delays grow `InitialDelay`, `InitialDelay×Factor`, … capped at `MaxDelay`.
- If a service runs stably for `ResetAfter`, the attempt counter resets — so a service that fails once a day doesn't slowly exhaust its budget.
- With `MaxAttempts: 0` the host restarts forever; with a positive value, exhausting the attempts stops the host with an error naming the service.
- A clean exit is still an exit: restart policies react to `Start` returning **before** shutdown, whether or not it returned an error.

## Validation

The policy is validated at `Build` time (surfaced as an accumulated error): all fields must be non-negative, the normalized `Factor` must be ≥ 1, and the normalized `MaxDelay` must be ≥ `InitialDelay`. An invalid policy fails the build rather than misbehaving at runtime.

## Observing restarts

Restart attempts are reported through the [`Observer`](./observability.md):

```go
shost.Observer{
	ServiceRestarting: func(name string, attempt int, delay time.Duration, err error) {
		// attempt N, backing off for `delay`, because `err`
	},
}
```

The OpenTelemetry module turns these into the `shost.service.restarts` counter.
