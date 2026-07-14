# Consumers

A consumer handles messages of one type. smsg mirrors MassTransit's `IConsumer<T>`:

```go
type Consumer[T any] interface {
	Consume(ctx context.Context, m Message[T]) error
}
```

`Message[T]` is the deserialized delivery:

```go
type Message[T any] struct {
	Body          T                 // the payload
	ID            string            // unique message id
	CorrelationID string            // set by the publisher, "" otherwise
	Topic         string            // topic the message arrived on
	Timestamp     time.Time         // publish time, UTC
	Headers       map[string]string // user headers
	Attempt       int               // 1-based, across in-process retries
}
```

Returning `nil` acknowledges the message. Returning an error triggers the consumer's [retry policy](./retry-dlq.md).

## Registering

`For` erases a typed consumer into a registration the bus can run; `Handle` does the same for a plain function:

```go
smsg.New().
	AddConsumer(smsg.For[OrderCreated](&BillingConsumer{}),
		smsg.Topic("orders"), smsg.Group("billing")).
	AddConsumer(smsg.Handle[OrderCreated](func(ctx context.Context, m smsg.Message[OrderCreated]) error {
		return audit(ctx, m.Body)
	}), smsg.Topic("orders"), smsg.Group("audit"))
```

Each `AddConsumer` becomes exactly one subscription. The `(topic, group)` pair must be unique per bus — a duplicate is a `Build` error.

## Options and defaults

```go
func Topic(name string) ConsumerOption        // default: the message type name (via TopicNamer)
func Group(name string) ConsumerOption        // default: the topic name
func Concurrency(n int) ConsumerOption        // default: 1
func Retry(p RetryPolicy) ConsumerOption      // default: the bus-wide WithRetry, else no retry
func DeadLetter(topic string) ConsumerOption  // default: none (exhausted messages are dropped)
func OnExhausted(a ExhaustedAction) ConsumerOption
func ConsumerMeta(key, value string) ConsumerOption // transport hints
```

With no options at all, `AddConsumer(smsg.For[OrderCreated](c))` subscribes to topic `OrderCreated`, group `OrderCreated`, one message at a time. Anonymous message types cannot derive a topic — name it with `Topic(...)` or `Build` fails.

## Groups: compete and fan out

The group is the unit of competition — the Kafka consumer group, or the RabbitMQ queue bound to the topic's exchange:

- **Within one group**, instances compete: each message is handled once per group, load-balanced across processes and across the `Concurrency` workers inside each process. Scale out by running more instances with the same group name.
- **Across groups**, messages fan out: every group receives its own copy. `billing` and `audit` above both see every order.

## Concurrency

`Concurrency(n)` allows up to `n` handler invocations in flight for that subscription. Consumers registered with `Concurrency > 1` must be safe for concurrent use. On Kafka, parallelism follows partitions, so ordering within a partition is preserved; on RabbitMQ the prefetch window equals the concurrency.

## Sharing one topic between message types

The envelope carries a `MessageType` (the Go type name). A consumer receiving a delivery whose type does not match its own acknowledges and skips it with a debug log — so several message types can share one topic, each with its own consumer group:

```go
AddConsumer(smsg.For[OrderCreated](oc), smsg.Topic("events"), smsg.Group("orders")).
AddConsumer(smsg.For[PaymentFailed](pf), smsg.Topic("events"), smsg.Group("payments"))
```

## Consumer lifetime and panics

Consumers run for the lifetime of the bus. A panic inside `Consume` is recovered, converted into an error carrying the stack trace, and follows the normal failure path (retry → dead-letter/drop) — it never takes the process down.

Deserialization failures follow the same failure path: an undecodable message is retried (pointlessly, but bounded) and then dead-lettered or dropped, so a bad payload cannot wedge a subscription.
