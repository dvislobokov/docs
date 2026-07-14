# Observability

The core carries zero telemetry dependencies. Observability plugs in through two small surfaces: a logger interface and an observer of callbacks.

## Logging

The bus logs through a four-method interface using srog-style message templates:

```go
type Logger interface {
	Debug(template string, args ...any)
	Information(template string, args ...any)
	Warning(template string, args ...any)
	Error(err error, template string, args ...any)
}
```

The method set is signature-compatible with [srog](/srog/), so `*srog.Logger` is accepted directly; `SlogLogger` adapts the standard library:

```go
smsg.New().WithLogger(srog.MustNew(srog.WithConsole()))
smsg.New().WithLogger(smsg.SlogLogger(slog.Default()))
```

Without a logger the bus stays silent — errors are still returned from `Start`/`Stop`/`Publish` and visible to the observer. What gets logged: lifecycle at Information, message flow at Debug, drops and dead-letters at Warning, failures at Error.

## The Observer

`Observer` is a struct of optional callbacks — set only the ones you need. Callbacks run synchronously on the bus hot path; panics are recovered and logged, so a faulty observer cannot take the bus down.

```go
type Observer struct {
	BusStarted          func()
	BusStopped          func(err error)
	SubscriptionStarted func(topic, group string)
	SubscriptionStopped func(topic, group string, err error)
	Published           func(topic string, env *Envelope, elapsed time.Duration, err error)
	Consumed            func(topic, group, messageID string, attempt int, elapsed time.Duration, err error)
	RetryScheduled      func(topic, group, messageID string, attempt int, delay time.Duration, err error)
	DeadLettered        func(topic, group, dlqTopic, messageID string, err error)
	Dropped             func(topic, group, messageID string, err error)
}
```

Wiring Prometheus-style metrics:

```go
smsg.New().WithObserver(smsg.Observer{
	Published: func(topic string, _ *smsg.Envelope, elapsed time.Duration, err error) {
		publishDuration.WithLabelValues(topic, status(err)).Observe(elapsed.Seconds())
	},
	Consumed: func(topic, group, _ string, attempt int, elapsed time.Duration, err error) {
		consumeDuration.WithLabelValues(topic, group, status(err)).Observe(elapsed.Seconds())
	},
	DeadLettered: func(topic, group, _, _ string, _ error) {
		deadLetters.WithLabelValues(topic, group).Inc()
	},
})
```

Multiple `WithObserver` calls register multiple observers, invoked in order. For tracing, propagate the trace context through envelope headers (`WithHeader` on publish, `Message.Headers` on consume).

## Hosting with shost

The bus structurally satisfies `shost.Service` and `shost.Readier` — no import between the libraries:

```go
func (b *Bus) Name() string
func (b *Bus) Start(ctx context.Context) error // blocks; returns on ctx cancel, Stop, or failure
func (b *Bus) Stop(ctx context.Context) error  // drains in-flight within the ctx deadline
func (b *Bus) Ready() <-chan struct{}          // closed once all subscriptions run
```

What the host gives you:

- **Readiness gating** — services after the bus start only once every subscription is live.
- **Graceful drain** — on shutdown, subscriptions stop fetching and in-flight messages finish within the shutdown timeout.
- **Broker-loss supervision** — a dead subscription (lost connection, fatal fetch error) makes `Start` return an error; `shost.WithRestart` restarts the bus with backoff, which reconnects and resubscribes:

```go
shost.New().
	AddService(bus, shost.WithRestart(shost.RestartPolicy{MaxAttempts: 0})). // unlimited
	MustBuild().
	Run()
```
