# Kafka transport

`smsg/kafka` (separate module, built on [twmb/franz-go](https://github.com/twmb/franz-go)) connects the bus to Kafka — or anything speaking the Kafka protocol, such as Redpanda.

```sh
go get github.com/dvislobokov/smsg/kafka   # requires Go 1.25+
```

```go
bus := smsg.New().
	WithTransport(kafka.New(kafka.Config{
		Brokers:          []string{"localhost:9092"},
		AutoCreateTopics: true,
	})).
	...
```

## Configuration

```go
type Config struct {
	Brokers          []string    // seed brokers (required)
	ClientID         string      // default "smsg"
	TLS              *tls.Config
	AutoCreateTopics bool        // let produce/fetch create missing topics
	Opts             []kgo.Opt   // escape hatch: SASL, timeouts, anything kgo supports
}

func New(cfg Config, opts ...Option) *Transport
func WithName(name string) Option // transport name in logs; default "kafka"
```

SASL goes through the escape hatch:

```go
kafka.Config{
	Brokers: brokers,
	Opts: []kgo.Opt{
		kgo.SASL(scram.Auth{User: user, Pass: pass}.AsSha256Mechanism()),
	},
}
```

## Mapping

| smsg | Kafka |
|---|---|
| Topic | topic |
| Group | consumer group |
| Fan-out across groups | every group reads the full log |
| Competing within a group | partition assignment |
| Envelope fields | record headers (`smsg-message-id`, `smsg-message-type`, `content-type`, …) |
| Record key | `kafka.PartitionKey(...)` metadata, else the message ID |

## Offsets: explicit commits

Auto-commit is disabled. An offset is committed only after the bus pipeline returns `nil` for the record — that is, after the message was consumed, dead-lettered or dropped. A dead-lettered record's offset is committed only *after* the DLQ publish succeeded, so failed messages cannot be lost between the two steps.

A handler error (only possible with `ExhaustedRequeue`, or when the DLQ publish itself failed) is retried in place with capped backoff, blocking that partition — the correct at-least-once response to broker trouble.

## Ordering and concurrency

Records within a partition are processed strictly in order. `Concurrency(n)` parallelizes across partitions, up to `n` at a time. To keep related messages ordered, give them the same partition key:

```go
bus.Publish(ctx, order, kafka.PartitionKey(order.ID))
```

## Consumer options

```go
func PartitionKey(key string) smsg.PublishOption
func StartOffsetFirst() smsg.ConsumerOption // new groups start from the earliest record
func StartOffsetLast() smsg.ConsumerOption  // the default, for symmetry
```

`StartOffsetFirst` matters for new consumer groups: without it, a group created after messages were produced starts at the log's end.

## Connection loss

Like the RabbitMQ transport, kafka is fail-fast: a fatal fetch or commit error ends the subscription, `Bus.Start` returns the error, and a supervising host (`shost.WithRestart`) restarts the bus. Transient broker hiccups are absorbed by franz-go's internal retries first.

## Integration tests

```sh
docker compose up -d redpanda
SMSG_KAFKA_BROKERS=localhost:9092 go test ./kafka/...
```

The tests skip when `SMSG_KAFKA_BROKERS` is not set.
