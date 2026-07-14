# Publishing

```go
func (b *Bus) Publish(ctx context.Context, msg any, opts ...PublishOption) error
```

`Publish` serializes the message, wraps it in an envelope and hands it to the transport. It is safe for concurrent use once the bus has started; before `Start` it returns `ErrNotStarted`, after `Stop` — `ErrStopped`.

## Topics

The topic is derived from the message type name — `OrderCreated` publishes to `OrderCreated` — unless overridden:

```go
bus.Publish(ctx, OrderCreated{...})                       // topic "OrderCreated"
bus.Publish(ctx, OrderCreated{...}, smsg.ToTopic("orders")) // explicit
```

To change the convention bus-wide, provide a `TopicNamer`:

```go
smsg.New().WithTopicNamer(func(t reflect.Type) string {
	return "myapp." + strings.ToLower(t.Name())
})
```

The same namer drives consumer-side topic defaults, so publisher and consumer stay in sync. Anonymous types cannot derive a topic; `Publish` returns `ErrNoTopic` unless `ToTopic` is given.

## The envelope

Every published message travels in an `Envelope`:

| Field | Set from |
|---|---|
| `MessageID` | generated (128-bit random hex), or `WithMessageID` |
| `CorrelationID` | `WithCorrelationID` |
| `MessageType` | the Go type name |
| `ContentType` | the serializer, `application/json` by default |
| `Topic` | derived or `ToTopic` |
| `Timestamp` | publish time, UTC |
| `Headers` | `WithHeader(key, value)` — carried on the wire |
| `Metadata` | `Meta(key, value)` — transport hints, **not** serialized |

Transports map these onto their native wire format (AMQP properties, Kafka record headers) and reconstruct the envelope on the consuming side, so `Message[T]` looks identical regardless of broker.

## Publish options

```go
func ToTopic(topic string) PublishOption
func WithMessageID(id string) PublishOption
func WithCorrelationID(id string) PublishOption
func WithHeader(key, value string) PublishOption
func Meta(key, value string) PublishOption
```

Transport submodules add typed sugar over `Meta`:

```go
bus.Publish(ctx, order,
	kafka.PartitionKey(order.ID))          // per-order ordering on Kafka

bus.Publish(ctx, order,
	rabbit.RoutingKey("orders.eu.berlin"), // topic-exchange routing on RabbitMQ
	rabbit.PublishExchangeType("topic"))
```

A transport ignores metadata outside its namespace, so the same `Publish` call works on any broker.

## Serialization

JSON (`encoding/json`) is the default. Replace it bus-wide:

```go
type Serializer interface {
	ContentType() string
	Serialize(v any) ([]byte, error)
	Deserialize(data []byte, v any) error
}

smsg.New().WithSerializer(myProtobufSerializer)
```

One serializer serves both directions — publisher and consumers must agree on it.
