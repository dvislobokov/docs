# Testing

The core module ships everything needed to test messaging code without a broker: the `inmem` transport (real-broker semantics, in-process) and the `smsgtest` helpers. Both are standard library only.

## The inmem transport

```go
bus := smsg.New().WithTransport(inmem.New())
```

Semantics mirror the real transports, so behavior verified against inmem carries over:

- messages fan out across consumer groups and compete within one;
- publish blocks when a group's buffer is full (backpressure), default 128 per `(topic, group)`, tunable with `inmem.WithBuffer(n)`;
- topics with no subscribers drop messages, like a broker;
- graceful close waits for in-flight handlers.

To connect several buses — a publisher service and a consumer service in one test — share a `Broker`:

```go
broker := inmem.NewBroker()
pub := smsg.New().WithTransport(broker.Transport())...
sub := smsg.New().WithTransport(broker.Transport())...
```

## Running a bus in a test

```go
const DefaultTimeout = 10 * time.Second

func Start(t testing.TB, b *smsg.Builder) *Bus

func (b *Bus) Bus() *smsg.Bus
func (b *Bus) Publish(msg any, opts ...smsg.PublishOption) // t.Fatal on error
func (b *Bus) Wait() error  // blocks until Start returns
func (b *Bus) Stop() error  // graceful stop; returns the shutdown error
```

`smsgtest.Start` builds the bus, runs it in a goroutine and blocks until it is ready. Build errors, startup failures and a startup hanging beyond `DefaultTimeout` fail the test. A `t.Cleanup` stops the bus automatically; call `Stop` explicitly only to assert on the shutdown error.

## Collecting messages

`Collector[T]` is a consumer that captures everything it receives:

```go
col := smsgtest.NewCollector[OrderCreated]()
bus := smsgtest.Start(t, smsg.New().
	WithTransport(inmem.New()).
	AddConsumer(col.Registration(), smsg.Topic("orders")))

bus.Publish(OrderCreated{ID: "42"}, smsg.ToTopic("orders"))

got := col.Wait(t, 1) // blocks until >= 1 message; fails after DefaultTimeout
if got[0].Body.ID != "42" { ... }
```

`col.Messages()` returns a snapshot without waiting.

## Recording bus events

`Recorder` mirrors the [Observer](./observability.md) into an event list — assert on retries, dead-letters and lifecycle without instrumenting consumers:

```go
rec := smsgtest.NewRecorder()
bus := smsgtest.Start(t, smsg.New().
	WithTransport(inmem.New()).
	WithObserver(rec.Observer()).
	AddConsumer(failing, smsg.Topic("orders"),
		smsg.Retry(smsg.RetryPolicy{MaxAttempts: 3, InitialDelay: time.Millisecond}),
		smsg.DeadLetter("orders.dlq")))

bus.Publish(OrderCreated{ID: "42"}, smsg.ToTopic("orders"))

rec.WaitFor(t, smsgtest.DeadLettered, 1)
retries := rec.WaitFor(t, smsgtest.RetryScheduled, 2)
```

Event kinds: `BusStarted`, `BusStopped`, `SubscriptionStarted`, `SubscriptionStopped`, `Published`, `Consumed`, `RetryScheduled`, `DeadLettered`, `Dropped`. Each `Event` carries the topic, group, message ID, attempt and error where applicable.

## Integration tests against real brokers

Keep them env-gated so the suite runs anywhere and exercises real topology where available:

```go
url := os.Getenv("SMSG_RABBIT_URL")
if url == "" {
	t.Skip("SMSG_RABBIT_URL not set; skipping integration test")
}
```

Use unique topic names per run (e.g. a timestamp suffix) so reruns do not collide on durable broker state. The repository's own rabbit and kafka test suites follow this pattern, with `docker-compose.yml` providing local brokers.
