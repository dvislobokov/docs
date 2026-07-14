# smsg

smsg is a typed messaging bus for Go, inspired by `MassTransit`. It removes the boilerplate around broker clients: consumers are plain generic interfaces, messages travel in envelopes with identifiers and headers, failures are retried with backoff and dead-lettered, and the broker sits behind a small transport SPI — swap RabbitMQ for Kafka (or an in-memory transport in tests) without touching consumer code.

## Why smsg

- **Typed consumers.** Implement `Consume(ctx, smsg.Message[OrderCreated]) error` — deserialization, envelope metadata and attempt counting are handled for you. No `[]byte`, no type switches.
- **One abstraction, real brokers.** The same bus runs on RabbitMQ, Kafka or fully in-process. Topics fan out across consumer groups; consumers compete within a group — on every transport.
- **Envelope semantics.** Every message carries a `MessageID`, optional `CorrelationID`, its `MessageType`, `ContentType`, timestamp and user headers. Several message types can share one topic; consumers skip foreign types.
- **Retry that behaves the same everywhere.** In-process exponential backoff per consumer or bus-wide. Retries are identical on every transport because the core runs them.
- **Dead-lettering, never a silent poison loop.** Exhausted messages are published to a dead-letter topic with `smsg-error`, `smsg-attempts` and `smsg-origin-topic` headers. Without a DLQ the message is dropped with a warning; broker redelivery is opt-in.
- **A shost service out of the box.** The bus structurally satisfies `shost.Service` and `Readier`: `AddService(bus)` gives you graceful drain of in-flight messages on shutdown and restart supervision on a lost broker connection.
- **Standard library only.** The core module — including the `inmem` transport and the `smsgtest` helpers — has no external dependencies. Broker clients live in separate submodules.
- **Testable without a broker.** `inmem` mirrors real-broker semantics; `smsgtest` runs the bus inside a test with automatic cleanup, collects messages and records events.
- **Observability without coupling.** Every lifecycle and message event flows through an `Observer` struct of callbacks. Logging is interface-based — srog satisfies it directly, and `SlogLogger` adapts `log/slog`.

Part of the `s*` family alongside [sconf](/sconf/) (configuration), [sorm](/sorm/) (ORM), [srog](/srog/) (logging) and [shost](/shost/) (hosting).

## Installation

```sh
go get github.com/dvislobokov/smsg          # core + inmem + smsgtest (stdlib only, Go 1.22+)
go get github.com/dvislobokov/smsg/rabbit   # RabbitMQ transport (amqp091-go)
go get github.com/dvislobokov/smsg/kafka    # Kafka transport (twmb/franz-go, Go 1.25+)
```

## A minimal example

```go
package main

import (
	"context"
	"os"

	"github.com/dvislobokov/shost"
	"github.com/dvislobokov/smsg"
	"github.com/dvislobokov/smsg/rabbit"
	"github.com/dvislobokov/srog"
)

type OrderCreated struct {
	ID    string
	Total float64
}

type BillingConsumer struct{ /* dependencies */ }

func (c *BillingConsumer) Consume(ctx context.Context, m smsg.Message[OrderCreated]) error {
	return charge(ctx, m.Body.ID, m.Body.Total)
}

func main() {
	log := srog.MustNew(srog.WithConsole()) // satisfies smsg.Logger directly
	defer log.Close()

	bus := smsg.New().
		WithName("orders-bus").
		WithLogger(log).
		WithTransport(rabbit.New(rabbit.Config{URL: os.Getenv("AMQP_URL")})).
		AddConsumer(smsg.For[OrderCreated](&BillingConsumer{}),
			smsg.Topic("orders"), smsg.Group("billing"),
			smsg.Concurrency(8),
			smsg.Retry(smsg.RetryPolicy{MaxAttempts: 5}),
			smsg.DeadLetter("orders.dlq")).
		MustBuild()

	shost.New().
		WithLogger(log).
		AddService(bus, shost.WithRestart(shost.RestartPolicy{})).
		MustBuild().
		Run()
}
```

Publishing, from anywhere the bus is available:

```go
err := bus.Publish(ctx, OrderCreated{ID: "42", Total: 9.99},
	smsg.WithCorrelationID(requestID))
```

## How concepts map to brokers

| smsg | RabbitMQ | Kafka |
|---|---|---|
| Topic | durable exchange (fanout by default) | topic |
| Group | durable queue `<topic>.<group>` bound to the exchange | consumer group |
| Fan-out | every group's queue gets a copy | every group reads the full log |
| Competing consumers | one queue, prefetch = `Concurrency` | partitions within the group |
| Acknowledge | `Ack` after the bus accepts the message | explicit offset commit |

## Package layout

| Package | Contents |
|---|---|
| `smsg` | `Builder`, `Bus`, `Consumer[T]`/`Message[T]`, `Envelope`, `RetryPolicy`, options, transport SPI, `Observer`, `Logger`, `SlogLogger` |
| `smsg/inmem` | in-process transport with real-broker semantics, for tests and examples |
| `smsg/smsgtest` | run a bus in tests; `Collector[T]` and `Recorder` for assertions |
| `smsg/rabbit` | RabbitMQ transport on amqp091-go (separate module) |
| `smsg/kafka` | Kafka transport on twmb/franz-go (separate module) |

Runnable programs live in the repository's `examples/` directory (inmem, RabbitMQ and Kafka, the latter two hosted by shost).

## Where to go next

- [Quick start](./quick-start.md) — a consumer, a publisher and a test in five minutes.
- [Consumers](./consumers.md) — `For`/`Handle`, consumer options, concurrency, shared topics.
- [Publishing](./publishing.md) — envelopes, topics, publish options, serialization.
- [Retry and dead-lettering](./retry-dlq.md) — policies, exhausted actions, DLQ headers.
- [RabbitMQ transport](./rabbit.md) — topology, routing, configuration.
- [Kafka transport](./kafka.md) — offsets, partitions, configuration.
- [Testing](./testing.md) — `inmem` and `smsgtest`.
- [Observability](./observability.md) — `Observer`, logging, shost integration.
- [API reference](./api.md) — every exported symbol.

Source: [github.com/dvislobokov/smsg](https://github.com/dvislobokov/smsg)
