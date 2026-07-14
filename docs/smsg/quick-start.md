# Quick start

This walkthrough builds an order-processing service: a typed consumer, a publisher, dead-lettering — and a test that runs the whole thing without a broker.

## 1. Define a message and a consumer

Messages are plain structs. Consumers implement one generic method:

```go
type OrderCreated struct {
	ID    string
	Total float64
}

type BillingConsumer struct {
	payments *PaymentClient
}

func (c *BillingConsumer) Consume(ctx context.Context, m smsg.Message[OrderCreated]) error {
	// m.Body is the deserialized payload. m.ID, m.CorrelationID,
	// m.Headers and m.Attempt carry the envelope metadata.
	return c.payments.Charge(ctx, m.Body.ID, m.Body.Total)
}
```

For small handlers, skip the struct with `smsg.Handle`:

```go
smsg.Handle[OrderCreated](func(ctx context.Context, m smsg.Message[OrderCreated]) error {
	fmt.Println("audit:", m.Body.ID)
	return nil
})
```

## 2. Build the bus

```go
bus := smsg.New().
	WithName("orders-bus").
	WithLogger(log). // *srog.Logger or smsg.SlogLogger(slog.Default())
	WithTransport(rabbit.New(rabbit.Config{URL: os.Getenv("AMQP_URL")})).
	AddConsumer(smsg.For[OrderCreated](&BillingConsumer{payments: payments}),
		smsg.Topic("orders"), smsg.Group("billing"),
		smsg.Concurrency(8),
		smsg.Retry(smsg.RetryPolicy{MaxAttempts: 5}),
		smsg.DeadLetter("orders.dlq")).
	MustBuild()
```

Every `AddConsumer` becomes one subscription: the `billing` group on the `orders` topic, up to 8 messages in flight, 5 attempts with exponential backoff, then the dead-letter topic. Configuration errors accumulate and are reported together by `Build` (or panic in `MustBuild`).

Swapping the broker is one line — the consumers do not change:

```go
WithTransport(kafka.New(kafka.Config{Brokers: []string{"localhost:9092"}}))
WithTransport(inmem.New()) // in tests
```

## 3. Run it

The bus is a long-running service: `Start` blocks, `Stop` drains. Host it with [shost](/shost/) and you get signal handling, graceful shutdown and broker-loss supervision for free:

```go
shost.New().
	WithLogger(log).
	AddService(bus, shost.WithRestart(shost.RestartPolicy{})).
	MustBuild().
	Run()
```

Without shost, drive the lifecycle yourself:

```go
ctx, cancel := context.WithCancel(context.Background())
go bus.Start(ctx)
<-bus.Ready()

// ... run ...

cancel()
stopCtx, stop := context.WithTimeout(context.Background(), 30*time.Second)
defer stop()
bus.Stop(stopCtx) // drains in-flight messages within the deadline
```

## 4. Publish

```go
err := bus.Publish(ctx, OrderCreated{ID: "42", Total: 9.99},
	smsg.WithCorrelationID(requestID),
	smsg.WithHeader("tenant", "acme"))
```

The topic defaults to the message type name (`OrderCreated`); pass `smsg.ToTopic("orders")` to name it explicitly, or set a bus-wide convention with `WithTopicNamer`.

## 5. Test without a broker

The `inmem` transport has the same semantics as the real ones; `smsgtest` handles the lifecycle:

```go
func TestBilling(t *testing.T) {
	col := smsgtest.NewCollector[OrderCreated]()
	bus := smsgtest.Start(t, smsg.New().
		WithTransport(inmem.New()).
		AddConsumer(col.Registration(), smsg.Topic("orders")))

	bus.Publish(OrderCreated{ID: "42", Total: 9.99}, smsg.ToTopic("orders"))

	got := col.Wait(t, 1)
	if got[0].Body.ID != "42" {
		t.Fatalf("wrong order: %+v", got[0])
	}
}
```

`smsgtest.Start` builds the bus, waits until it is ready and registers a cleanup that stops it — a hung bus fails the test instead of deadlocking the suite.

## Local brokers

The repository ships a `docker-compose.yml` with RabbitMQ and Redpanda for integration testing:

```sh
docker compose up -d
SMSG_RABBIT_URL=amqp://guest:guest@localhost:5672/ go test ./rabbit/...
SMSG_KAFKA_BROKERS=localhost:9092 go test ./kafka/...
```

## Next

- [Consumers](./consumers.md) — options, defaults, shared topics.
- [Retry and dead-lettering](./retry-dlq.md) — what happens when `Consume` returns an error.
- [Testing](./testing.md) — `Collector`, `Recorder`, shared brokers across buses.
