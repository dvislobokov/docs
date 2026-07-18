# Examples

A cookbook of complete, copy-paste-ready recipes for every part of smsg. Each example shows the setup, the code and what happens on the wire; most reuse one domain event, `OrderCreated`. For the underlying rules, follow the links into the reference pages.

[[toc]]

## 1. The smallest possible bus

One message type, one consumer, one publish — fully in-process, no broker.

```go
package main

import (
	"context"
	"fmt"
	"time"

	"github.com/dvislobokov/smsg"
	"github.com/dvislobokov/smsg/inmem"
)

type OrderCreated struct {
	ID    string
	Total float64
}

func main() {
	done := make(chan struct{})

	bus := smsg.New().
		WithTransport(inmem.New()).
		AddConsumer(smsg.Handle[OrderCreated](func(_ context.Context, m smsg.Message[OrderCreated]) error {
			fmt.Printf("order %s for %.2f (message %s)\n", m.Body.ID, m.Body.Total, m.ID)
			close(done)
			return nil
		})).
		MustBuild()

	ctx, cancel := context.WithCancel(context.Background())
	go bus.Start(ctx)
	<-bus.Ready() // all subscriptions are live

	bus.Publish(ctx, OrderCreated{ID: "42", Total: 9.99})

	<-done
	cancel()
	stopCtx, stop := context.WithTimeout(context.Background(), 5*time.Second)
	defer stop()
	bus.Stop(stopCtx) // drains in-flight messages
}
```

With no options at all, both sides derive the topic from the type name: the message is published to `OrderCreated`, and the consumer subscribes to topic `OrderCreated`, group `OrderCreated`, one message at a time. See [Quick start](./quick-start.md).

## 2. A typed consumer struct with dependencies

`Handle` is for small handlers; real consumers are structs implementing `Consumer[T]`, erased into a registration with `For`. See [Consumers](./consumers.md).

```go
type BillingConsumer struct {
	payments *PaymentClient
}

func (c *BillingConsumer) Consume(ctx context.Context, m smsg.Message[OrderCreated]) error {
	// m.Body is the deserialized payload; the rest is envelope metadata.
	// m.ID, m.CorrelationID, m.Topic, m.Timestamp, m.Headers, m.Attempt
	return c.payments.Charge(ctx, m.Body.ID, m.Body.Total)
}

bus := smsg.New().
	WithTransport(transport).
	AddConsumer(smsg.For[OrderCreated](&BillingConsumer{payments: payments}),
		smsg.Topic("orders"), smsg.Group("billing")).
	MustBuild()
```

Returning `nil` acknowledges the message; returning an error triggers the [retry policy](#8-retry-policies). A panic inside `Consume` is recovered, turned into an error with the stack trace, and follows the same failure path — it never takes the process down.

## 3. Consumer options and their defaults

```go
AddConsumer(smsg.For[OrderCreated](c),
	smsg.Topic("orders"),                          // default: TopicNamer(T) => "OrderCreated"
	smsg.Group("billing"),                         // default: the topic name
	smsg.Concurrency(8),                           // default: 1
	smsg.Retry(smsg.RetryPolicy{MaxAttempts: 5}),  // default: bus-wide WithRetry, else no retry
	smsg.DeadLetter("orders.dlq"),                 // default: none => exhausted messages are dropped
	smsg.OnExhausted(smsg.ExhaustedDeadLetter))    // default: DeadLetter when set, Drop otherwise
```

Each `AddConsumer` becomes exactly one subscription; the `(topic, group)` pair must be unique per bus. Configuration errors accumulate — `Build` reports them all at once via `errors.Join` (`MustBuild` panics; use it in `main`). Consumers registered with `Concurrency > 1` must be safe for concurrent use.

## 4. Groups: compete within, fan out across

The group is the unit of competition — a Kafka consumer group, or the RabbitMQ queue `<topic>.<group>`. See [Consumers](./consumers.md#groups-compete-and-fan-out).

```go
smsg.New().
	WithTransport(transport).
	AddConsumer(smsg.For[OrderCreated](&BillingConsumer{}),
		smsg.Topic("orders"), smsg.Group("billing")).
	AddConsumer(smsg.Handle[OrderCreated](func(ctx context.Context, m smsg.Message[OrderCreated]) error {
		return audit(ctx, m.Body)
	}), smsg.Topic("orders"), smsg.Group("audit"))
```

One `Publish` to `orders` now delivers **two** copies — one to `billing`, one to `audit`. Run three instances of this process and each copy is still handled once per group: instances with the same group name compete. Scale out by running more instances; scale up inside one process with `Concurrency(n)`.

## 5. Several message types on one topic

The envelope carries the `MessageType`; a consumer that receives a foreign type acknowledges and skips it with a debug log. So one `events` topic can carry a whole domain:

```go
type OrderCreated struct{ ID string; Total float64 }
type PaymentFailed struct{ OrderID, Reason string }

smsg.New().
	AddConsumer(smsg.For[OrderCreated](oc), smsg.Topic("events"), smsg.Group("orders")).
	AddConsumer(smsg.For[PaymentFailed](pf), smsg.Topic("events"), smsg.Group("payments"))

bus.Publish(ctx, OrderCreated{ID: "42", Total: 9.99}, smsg.ToTopic("events"))
bus.Publish(ctx, PaymentFailed{OrderID: "41", Reason: "card declined"}, smsg.ToTopic("events"))
```

Each consumer sees only its own type; the other deliveries are acked silently.

## 6. Topic naming: `ToTopic`, `TopicNamer`

By default the topic is the plain Go type name. Override per publish, or set a bus-wide convention that drives **both** the publisher and consumer defaults, keeping them in sync. See [Publishing](./publishing.md#topics).

```go
bus.Publish(ctx, OrderCreated{...})                         // topic "OrderCreated"
bus.Publish(ctx, OrderCreated{...}, smsg.ToTopic("orders")) // explicit

// Bus-wide convention: "myapp.ordercreated"
smsg.New().WithTopicNamer(func(t reflect.Type) string {
	return "myapp." + strings.ToLower(t.Name())
})
```

::: warning
Anonymous types cannot derive a topic: `Publish` returns `smsg.ErrNoTopic` unless `ToTopic` is given, and an `AddConsumer` without `Topic(...)` fails `Build`.
:::

## 7. Publish options: IDs, correlation, headers

```go
err := bus.Publish(ctx, OrderCreated{ID: "42", Total: 9.99},
	smsg.ToTopic("orders"),
	smsg.WithMessageID("ord-42-v1"),      // default: generated 128-bit random hex
	smsg.WithCorrelationID(requestID),    // shows up as m.CorrelationID on consume
	smsg.WithHeader("tenant", "acme"),    // carried on the wire => m.Headers["tenant"]
	smsg.Meta("kafka.partition-key", "42")) // transport hint, NOT serialized
```

What arrives on the consuming side, identical on every broker:

| Envelope field | Value |
|---|---|
| `m.ID` | `ord-42-v1` |
| `m.CorrelationID` | the request ID |
| `m.Topic` | `orders` |
| `m.Timestamp` | publish time, UTC |
| `m.Headers["tenant"]` | `acme` |
| `m.Attempt` | `1` (counts up across in-process retries) |

`Meta`/`ConsumerMeta` carry namespaced transport hints (`kafka.*`, `rabbit.*`); transports ignore metadata outside their namespace, so the same call works on any broker. Prefer the typed sugar from the transport submodules (examples [12](#12-rabbitmq-routing-with-topic-exchanges) and [14](#14-kafka-partition-keys-and-ordering)).

## 8. Retry policies

On a consumer error the **bus** retries in-process with exponential backoff — identical behavior on RabbitMQ, Kafka and inmem. See [Retry and dead-lettering](./retry-dlq.md).

```go
smsg.New().
	WithRetry(smsg.RetryPolicy{MaxAttempts: 3}).      // bus-wide default
	AddConsumer(reg, smsg.Retry(smsg.RetryPolicy{     // per-consumer override wins
		MaxAttempts:  5,
		InitialDelay: time.Second, // default 100ms
		MaxDelay:     time.Minute, // default 10s
		Factor:       2,           // default 2.0
	}))
```

With the override above, a consumer that keeps failing sees:

| Attempt | Delay before it |
|---|---|
| 1 | — |
| 2 | 1s |
| 3 | 2s |
| 4 | 4s |
| 5 | 8s |
| exhausted | dead-letter / requeue / drop |

`MaxAttempts` counts **total** attempts including the first; `0` means one attempt, no retry. Backoff occupies one of the consumer's `Concurrency` slots — deliberate backpressure: a failing dependency slows intake instead of piling up half-processed messages.

## 9. Dead-lettering, end to end

Exhausted messages are re-published to the dead-letter topic with diagnostic headers; a DLQ is a normal topic, so alerting is just another consumer:

```go
smsg.New().
	WithTransport(inmem.New()).
	// Always fails => after 3 attempts the message lands on orders.dlq.
	AddConsumer(smsg.Handle[OrderCreated](func(_ context.Context, m smsg.Message[OrderCreated]) error {
		return errors.New("fraud check unavailable")
	}), smsg.Topic("orders"), smsg.Group("fraud"),
		smsg.Retry(smsg.RetryPolicy{MaxAttempts: 3, InitialDelay: 50 * time.Millisecond}),
		smsg.DeadLetter("orders.dlq")).
	// The DLQ consumer sees the original envelope + diagnostics.
	AddConsumer(smsg.Handle[OrderCreated](func(_ context.Context, m smsg.Message[OrderCreated]) error {
		log.Warning("order {Id} dead-lettered after {Attempts} attempts on {Topic}: {Error}",
			m.Body.ID,
			m.Headers[smsg.HeaderAttempts],    // "3"
			m.Headers[smsg.HeaderOriginTopic], // "orders"
			m.Headers[smsg.HeaderError])       // "fraud check unavailable"
		return nil
	}), smsg.Topic("orders.dlq"))
```

The dead-lettered envelope keeps the original `MessageID`, body and user headers. The original is acknowledged only **after** the DLQ publish succeeds; if the DLQ publish fails (broker trouble), the error goes back to the transport for native redelivery — the message is never lost.

## 10. Exhausted actions: drop and requeue

Without a `DeadLetter` topic, an exhausted message is **dropped**: acknowledged with a warning, so a poison message can never silently block a subscription. Broker redelivery is opt-in:

```go
// Default without DeadLetter: ack + warning after MaxAttempts.
AddConsumer(reg, smsg.Retry(smsg.RetryPolicy{MaxAttempts: 3}))

// Opt in to native redelivery: RabbitMQ nack+requeue, Kafka uncommitted offset.
AddConsumer(reg, smsg.OnExhausted(smsg.ExhaustedRequeue))
```

::: warning
`ExhaustedRequeue` loops forever on a permanently failing message — use it only when redelivery is genuinely what you want (e.g. a strictly ordered stream where skipping is worse than stalling).
:::

## 11. RabbitMQ: connect and topology

`smsg/rabbit` is a separate module. Topics become durable exchanges (fanout by default), groups become durable queues `<topic>.<group>` bound to them; declarations are idempotent and happen on first use — no out-of-band setup. See [RabbitMQ transport](./rabbit.md).

```go
import "github.com/dvislobokov/smsg/rabbit"

bus := smsg.New().
	WithTransport(rabbit.New(rabbit.Config{
		URL:         "amqp://guest:guest@localhost:5672/", // required
		// Durable:     ptr(true),        // durable topology + persistent messages (default)
		// Prefetch:    16,               // per-subscription QoS; default = Concurrency
		// DialTimeout: 10 * time.Second, // default
		// TLS:         tlsConfig,        // enables amqps
	})).
	AddConsumer(smsg.For[OrderCreated](&BillingConsumer{}),
		smsg.Topic("orders"), smsg.Group("billing"), smsg.Concurrency(8)).
	MustBuild()
```

Resulting topology:

| Object | Name | Role |
|---|---|---|
| Exchange | `orders` | durable, fanout — every group's queue gets a copy |
| Queue | `orders.billing` | durable, competing consumers, prefetch 8 |

The config is validated at `Connect` — when `Bus.Start` runs — so a bad URL fails the host start, not the constructor. The transport is fail-fast on connection loss: `Start` returns the error and a supervising host restarts the bus (example [18](#18-hosting-with-shost-graceful-shutdown-and-broker-loss)).

## 12. RabbitMQ: routing with topic exchanges

Selective delivery via exchange type + binding/routing keys — typed sugar over core `Meta`/`ConsumerMeta`, so consumer code stays broker-free:

```go
// Consumer: only EU orders.
AddConsumer(reg, smsg.Topic("orders"), smsg.Group("eu"),
	rabbit.ExchangeType("topic"),      // "fanout" (default), "topic", "direct"
	rabbit.BindingKey("orders.eu.#"))  // default "#" for topic exchanges

// Publisher: stamp the routing key.
bus.Publish(ctx, order, smsg.ToTopic("orders"),
	rabbit.PublishExchangeType("topic"),
	rabbit.RoutingKey("orders.eu.berlin"))
```

`rabbit.Exchange("legacy-events")` subscribes a group to a foreign exchange declared by another system. On other transports these options are ignored — the same code runs unchanged on Kafka or inmem.

## 13. Kafka: connect, offsets, SASL

`smsg/kafka` (separate module, franz-go, Go 1.25+) maps topics to topics and groups to consumer groups. Auto-commit is disabled: an offset is committed only after the pipeline returns `nil` — consumed, dead-lettered or dropped — so failed messages cannot be lost. See [Kafka transport](./kafka.md).

```go
import (
	"github.com/dvislobokov/smsg/kafka"
	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/twmb/franz-go/pkg/sasl/scram"
)

bus := smsg.New().
	WithTransport(kafka.New(kafka.Config{
		Brokers:          []string{"localhost:9092"}, // required
		AutoCreateTopics: true,                       // let produce/fetch create missing topics
		// ClientID: "orders-svc",                    // default "smsg"
		Opts: []kgo.Opt{ // escape hatch: anything kgo supports
			kgo.SASL(scram.Auth{User: user, Pass: pass}.AsSha256Mechanism()),
		},
	})).
	AddConsumer(smsg.For[OrderCreated](&BillingConsumer{}),
		smsg.Topic("orders"), smsg.Group("billing"),
		smsg.Concurrency(4),
		kafka.StartOffsetFirst()). // new groups start from the earliest record
	MustBuild()
```

::: tip
`kafka.StartOffsetFirst()` matters for **new** consumer groups: without it, a group created after messages were produced starts at the log's end and never sees them. Works with Redpanda and anything else speaking the Kafka protocol.
:::

## 14. Kafka: partition keys and ordering

Records within a partition are processed strictly in order; `Concurrency(n)` parallelizes across partitions. Keep related messages ordered by giving them the same record key:

```go
bus.Publish(ctx, order, smsg.ToTopic("orders"),
	kafka.PartitionKey(order.ID)) // all events of one order land on one partition
```

Without `PartitionKey` the record key defaults to the message ID — effectively random distribution. A handler error under `ExhaustedRequeue` (or a failed DLQ publish) is retried in place with capped backoff, blocking that partition — the correct at-least-once response to broker trouble.

## 15. A custom serializer

JSON (`encoding/json`, `application/json`) is the default. One serializer serves both directions bus-wide — publisher and consumers must agree on it. See [Publishing](./publishing.md#serialization).

```go
type protobufSerializer struct{}

func (protobufSerializer) ContentType() string { return "application/x-protobuf" }

func (protobufSerializer) Serialize(v any) ([]byte, error) {
	return proto.Marshal(v.(proto.Message))
}

func (protobufSerializer) Deserialize(data []byte, v any) error {
	return proto.Unmarshal(data, v.(proto.Message))
}

smsg.New().WithSerializer(protobufSerializer{})
```

The `ContentType` travels in the envelope (AMQP content-type property, `content-type` Kafka record header). A message that cannot be deserialized follows the normal failure path — retried (bounded) and then dead-lettered or dropped, so a bad payload cannot wedge a subscription.

## 16. Testing with `inmem` and a `Collector`

The core module ships everything needed to test without a broker — standard library only. `smsgtest.Start` builds the bus, waits until it is ready and registers a cleanup that stops it; a hung bus fails the test instead of deadlocking the suite. See [Testing](./testing.md).

```go
func TestBilling(t *testing.T) {
	col := smsgtest.NewCollector[OrderCreated]()
	bus := smsgtest.Start(t, smsg.New().
		WithTransport(inmem.New()).
		AddConsumer(col.Registration(), smsg.Topic("orders")))

	bus.Publish(OrderCreated{ID: "42", Total: 9.99}, smsg.ToTopic("orders")) // t.Fatal on error

	got := col.Wait(t, 1) // blocks until >= 1 message; fails after 10s
	if got[0].Body.ID != "42" {
		t.Fatalf("wrong order: %+v", got[0])
	}
}
```

`inmem` mirrors real-broker semantics: fan-out across groups, competition within one, backpressure when a group's buffer fills (default 128 per `(topic, group)`, tune with `inmem.WithBuffer(n)`), drops on topics with no subscribers. To test a publisher service against a consumer service, share a broker between two buses:

```go
broker := inmem.NewBroker()
pub := smsgtest.Start(t, smsg.New().WithTransport(broker.Transport()))
sub := smsgtest.Start(t, smsg.New().WithTransport(broker.Transport()).
	AddConsumer(col.Registration(), smsg.Topic("orders")))
```

## 17. Asserting on retries and dead-letters: the `Recorder`

`Recorder` mirrors the [Observer](./observability.md#the-observer) into an event list — verify failure handling without instrumenting consumers:

```go
func TestDeadLetter(t *testing.T) {
	rec := smsgtest.NewRecorder()
	failing := smsg.Handle[OrderCreated](func(context.Context, smsg.Message[OrderCreated]) error {
		return errors.New("boom")
	})

	bus := smsgtest.Start(t, smsg.New().
		WithTransport(inmem.New()).
		WithObserver(rec.Observer()).
		AddConsumer(failing, smsg.Topic("orders"),
			smsg.Retry(smsg.RetryPolicy{MaxAttempts: 3, InitialDelay: time.Millisecond}),
			smsg.DeadLetter("orders.dlq")))

	bus.Publish(OrderCreated{ID: "42"}, smsg.ToTopic("orders"))

	rec.WaitFor(t, smsgtest.DeadLettered, 1)                  // exactly one dead-letter
	retries := rec.WaitFor(t, smsgtest.RetryScheduled, 2)     // two retries before it
	if retries[0].Attempt != 1 {
		t.Fatalf("unexpected first retry: %+v", retries[0])
	}
}
```

Event kinds: `BusStarted`, `BusStopped`, `SubscriptionStarted`, `SubscriptionStopped`, `Published`, `Consumed`, `RetryScheduled`, `DeadLettered`, `Dropped`; each `Event` carries topic, group, message ID, attempt and error where applicable. `rec.Events()` snapshots, `rec.Has(kind)` checks without waiting.

## 18. Hosting with shost: graceful shutdown and broker loss

The bus structurally satisfies `shost.Service` and `shost.Readier` — no import between the libraries. `AddService(bus)` gives you signal handling, readiness gating (services after the bus start only once every subscription is live), graceful drain of in-flight messages within the shutdown timeout, and restart supervision on a lost broker connection:

```go
bus := smsg.New().
	WithName("orders-bus").
	WithLogger(log).
	WithTransport(rabbit.New(rabbit.Config{URL: os.Getenv("AMQP_URL")})).
	AddConsumer(smsg.For[OrderCreated](&BillingConsumer{}),
		smsg.Topic("orders"), smsg.Group("billing"), smsg.Concurrency(8)).
	MustBuild()

shost.New().
	WithLogger(log).
	AddService(bus, shost.WithRestart(shost.RestartPolicy{})). // re-dial + re-declare on broker loss
	MustBuild().
	Run()
```

Both broker transports are fail-fast by design: when the connection dies, `Bus.Start` returns the error and the host restarts the bus with backoff, which reconnects and resubscribes. Without shost, drive the lifecycle yourself as in [example 1](#1-the-smallest-possible-bus) — `Start` blocks, `Ready()` closes once subscriptions run, `Stop` drains within its context deadline. A bus runs once: `Start` after `Stop` returns `ErrStopped`.

## 19. Observability: logging and metrics

Logging is a four-method interface — `*srog.Logger` satisfies it directly, `SlogLogger` adapts the standard library; without a logger the bus is silent. The `Observer` is a struct of optional callbacks on the bus hot path (panics inside are recovered). See [Observability](./observability.md).

```go
smsg.New().
	WithLogger(smsg.SlogLogger(slog.Default())). // or srog.MustNew(srog.WithConsole())
	WithObserver(smsg.Observer{
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

Multiple `WithObserver` calls register multiple observers, invoked in order. For tracing, propagate the trace context through envelope headers:

```go
// Publisher side:
bus.Publish(ctx, order, smsg.WithHeader("traceparent", traceparentFrom(ctx)))

// Consumer side:
func (c *BillingConsumer) Consume(ctx context.Context, m smsg.Message[OrderCreated]) error {
	ctx = contextWithTraceparent(ctx, m.Headers["traceparent"])
	// ...
}
```

## 20. Error handling, all the cases

```go
// Build: all configuration errors at once (errors.Join) —
// duplicate (topic, group), empty option values, missing transport,
// anonymous type without Topic(...).
bus, err := smsg.New().WithTransport(tr).AddConsumer(reg).Build()
if err != nil {
	log.Fatal(err) // MustBuild panics instead; fine in main()
}

// Publish:
err = bus.Publish(ctx, order)
switch {
case errors.Is(err, smsg.ErrNotStarted):
	// published before Start — start the bus (or gate on <-bus.Ready())
case errors.Is(err, smsg.ErrStopped):
	// published after Stop — the bus runs once
case errors.Is(err, smsg.ErrNoTopic):
	// anonymous type and no ToTopic(...)
case err != nil:
	// serialization or transport failure — safe to retry the Publish
}

// Start: returns nil after ctx cancel or Stop; returns an error when the
// transport fails to connect, a subscription cannot start, or a running
// subscription dies (broker loss). Under shost, WithRestart handles it.
if err := bus.Start(ctx); err != nil {
	log.Fatal(err)
}
```

Consumer-side errors never surface here — they flow through [retry, dead-lettering](./retry-dlq.md) and the [Observer](./observability.md) instead.
