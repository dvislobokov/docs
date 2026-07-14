# Retry and dead-lettering

When `Consume` returns an error (or panics), the bus — not the broker — decides what happens next. Because retries run in the consuming process, the behavior is identical on RabbitMQ, Kafka and inmem.

## The pipeline

For every delivery:

1. The consumer is invoked (panic-safe; a panic becomes an error with a stack trace).
2. On error, the bus retries in-process with exponential backoff, up to `RetryPolicy.MaxAttempts` total attempts. `Message.Attempt` counts up from 1.
3. When attempts are exhausted, the **exhausted action** runs: dead-letter, requeue, or drop.

Only after the pipeline finishes does the transport acknowledge (ack / commit the offset) — a crash mid-pipeline means the broker redelivers, so processing is at-least-once.

## RetryPolicy

```go
type RetryPolicy struct {
	MaxAttempts  int           // total attempts incl. the first; 0 => 1 (no retry)
	InitialDelay time.Duration // default 100ms
	MaxDelay     time.Duration // default 10s
	Factor       float64       // default 2.0
}
```

Set it per consumer or bus-wide (per-consumer wins):

```go
smsg.New().
	WithRetry(smsg.RetryPolicy{MaxAttempts: 3}). // bus-wide default
	AddConsumer(reg, smsg.Retry(smsg.RetryPolicy{ // override for this consumer
		MaxAttempts:  5,
		InitialDelay: time.Second,
	}))
```

Backoff while retrying occupies one of the consumer's `Concurrency` slots — deliberate backpressure: a failing dependency slows intake instead of piling up half-processed messages.

## Exhausted actions

```go
const (
	ExhaustedDeadLetter ExhaustedAction = iota // default when DeadLetter is set
	ExhaustedRequeue                           // hand the error to the transport
	ExhaustedDrop                              // ack + warning (default otherwise)
)
```

- **`ExhaustedDeadLetter`** — the envelope is published to the `DeadLetter(topic)` with diagnostic headers, then the original is acknowledged. If the DLQ publish itself fails (broker trouble), the error goes back to the transport for native redelivery — the message is never lost.
- **`ExhaustedDrop`** — the message is acknowledged and a warning is logged. This is the default when no dead-letter topic is configured, so a poison message can never silently block a subscription.
- **`ExhaustedRequeue`** — opt-in: the error is handed to the transport (RabbitMQ nack+requeue, Kafka uncommitted offset). Use it only when redelivery is genuinely what you want; a permanently failing message will loop.

```go
AddConsumer(reg,
	smsg.Retry(smsg.RetryPolicy{MaxAttempts: 5}),
	smsg.DeadLetter("orders.dlq")) // exhausted => dead-letter

AddConsumer(reg,
	smsg.OnExhausted(smsg.ExhaustedRequeue)) // exhausted => broker redelivery
```

## Dead-letter envelopes

A dead-lettered message is the original envelope — same `MessageID`, body and headers — plus three diagnostic headers:

| Header | Contents |
|---|---|
| `smsg.HeaderError` (`smsg-error`) | the final consumer error |
| `smsg.HeaderAttempts` (`smsg-attempts`) | how many attempts were made |
| `smsg.HeaderOriginTopic` (`smsg-origin-topic`) | the topic it failed on |

A DLQ topic is a normal topic — consume it like any other to build alerting or reprocessing:

```go
AddConsumer(smsg.Handle[OrderCreated](func(ctx context.Context, m smsg.Message[OrderCreated]) error {
	log.Warning("order {Id} dead-lettered after {Attempts}: {Error}",
		m.Body.ID, m.Headers[smsg.HeaderAttempts], m.Headers[smsg.HeaderError])
	return nil
}), smsg.Topic("orders.dlq"))
```

## Observing failures

Every step emits an [Observer](./observability.md) event: `Consumed` (with the error and attempt), `RetryScheduled`, `DeadLettered`, `Dropped` — wire them to metrics to see failure rates per topic and group.
