# RabbitMQ transport

`smsg/rabbit` (separate module, built on [amqp091-go](https://github.com/rabbitmq/amqp091-go)) connects the bus to RabbitMQ.

```sh
go get github.com/dvislobokov/smsg/rabbit
```

```go
bus := smsg.New().
	WithTransport(rabbit.New(rabbit.Config{
		URL: "amqp://guest:guest@localhost:5672/",
	})).
	...
```

## Configuration

```go
type Config struct {
	URL         string        // AMQP connection string (required)
	Durable     *bool         // durable topology + persistent messages; default true
	Prefetch    int           // per-subscription QoS; default = the subscription's Concurrency
	DialTimeout time.Duration // default 10s
	TLS         *tls.Config   // enables amqps
}

func New(cfg Config, opts ...Option) *Transport
func WithName(name string) Option // transport name in logs; default "rabbit"
```

Configuration is validated at `Connect` — i.e. when `Bus.Start` runs — so a bad config fails the host start, not the constructor.

## Topology

| smsg | RabbitMQ object |
|---|---|
| Topic | durable exchange named after the topic, `fanout` by default |
| Group | durable queue `<topic>.<group>`, bound to the exchange |
| Dead-letter topic | its own exchange + queue, like any topic |

Declarations are idempotent and happen on first use — no out-of-band setup step. With the default fanout exchange every group's queue receives a copy of every message, and consumers within a group compete on their queue with `Qos(prefetch)`.

## Routing with topic exchanges

Override the exchange type and keys to route selectively:

```go
// Consumer: only EU orders.
AddConsumer(reg, smsg.Topic("orders"), smsg.Group("eu"),
	rabbit.ExchangeType("topic"),
	rabbit.BindingKey("orders.eu.#"))

// Publisher: stamp the routing key.
bus.Publish(ctx, order, smsg.ToTopic("orders"),
	rabbit.PublishExchangeType("topic"),
	rabbit.RoutingKey("orders.eu.berlin"))
```

Available sugar (all compile down to core `Meta`/`ConsumerMeta`, so the core never imports the transport):

```go
func Exchange(name string) smsg.ConsumerOption      // subscribe to a foreign exchange
func ExchangeType(kind string) smsg.ConsumerOption  // "fanout" (default), "topic", "direct"
func BindingKey(key string) smsg.ConsumerOption     // default "#" for topic exchanges
func RoutingKey(key string) smsg.PublishOption
func PublishExchangeType(kind string) smsg.PublishOption
```

## Acknowledge and redelivery

- Handler pipeline returns `nil` (consumed, dead-lettered or dropped) → `Ack`.
- Handler pipeline returns an error (only possible with `ExhaustedRequeue` or a failed DLQ publish) → `Nack(requeue)` with a short pause, so a broker outage does not spin.
- `Delivery.Attempt` is populated from `x-death` when present, else from the `Redelivered` flag.

## Connection loss

The transport is fail-fast by design: when the connection dies, every subscription ends with the error, `Bus.Start` returns it, and a supervising host restarts the bus — which re-dials and re-declares. Pair the bus with shost restart supervision:

```go
shost.New().AddService(bus, shost.WithRestart(shost.RestartPolicy{}))
```

In-adapter auto-reconnect is intentionally out of scope for v1.

## Integration tests

```sh
docker compose up -d rabbitmq
SMSG_RABBIT_URL=amqp://guest:guest@localhost:5672/ go test ./rabbit/...
```

The tests skip when `SMSG_RABBIT_URL` is not set.
