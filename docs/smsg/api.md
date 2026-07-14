# API reference

Every exported symbol, by package.

## Package smsg

### Building a bus

```go
func New() *Builder

func (b *Builder) WithName(name string) *Builder            // Bus.Name(); default "smsg"
func (b *Builder) WithTransport(t Transport) *Builder       // required, exactly one
func (b *Builder) WithLogger(l Logger) *Builder             // default: silent
func (b *Builder) WithSerializer(s Serializer) *Builder     // default: JSON()
func (b *Builder) WithTopicNamer(fn TopicNamer) *Builder    // default: DefaultTopicNamer
func (b *Builder) WithRetry(p RetryPolicy) *Builder         // bus-wide default retry
func (b *Builder) WithObserver(o Observer) *Builder         // may be called repeatedly
func (b *Builder) AddConsumer(c ConsumerRegistration, opts ...ConsumerOption) *Builder
func (b *Builder) Build() (*Bus, error)                     // errors.Join of all config errors
func (b *Builder) MustBuild() *Bus                          // panics on error; for main()

const DefaultName = "smsg"
```

### Bus

```go
func (b *Bus) Name() string
func (b *Bus) Start(ctx context.Context) error // blocks for the bus lifetime
func (b *Bus) Stop(ctx context.Context) error  // graceful drain; idempotent
func (b *Bus) Ready() <-chan struct{}          // closed once all subscriptions run
func (b *Bus) Publish(ctx context.Context, msg any, opts ...PublishOption) error
```

`Start` returns nil after `ctx` is canceled or `Stop` is called; it returns an error when the transport fails to connect, a subscription cannot start, or a running subscription dies. The lifecycle satisfies `shost.Service` + `shost.Readier` structurally. A bus runs once — `Start` after `Stop` returns `ErrStopped`.

### Consumers and messages

```go
type Consumer[T any] interface {
	Consume(ctx context.Context, m Message[T]) error
}

type ConsumerFunc[T any] func(ctx context.Context, m Message[T]) error

type Message[T any] struct {
	Body          T
	ID            string
	CorrelationID string
	Topic         string
	Timestamp     time.Time
	Headers       map[string]string
	Attempt       int // 1-based across in-process retries
}

func For[T any](c Consumer[T]) ConsumerRegistration
func Handle[T any](fn func(ctx context.Context, m Message[T]) error) ConsumerRegistration

type ConsumerRegistration struct{ /* opaque; produced by For and Handle */ }
```

### Consumer options

```go
type ConsumerOption func(*consumerConfig)

func Topic(name string) ConsumerOption               // default: TopicNamer(T)
func Group(name string) ConsumerOption               // default: the topic name
func Concurrency(n int) ConsumerOption               // default: 1
func Retry(p RetryPolicy) ConsumerOption             // overrides WithRetry
func DeadLetter(topic string) ConsumerOption
func OnExhausted(a ExhaustedAction) ConsumerOption
func ConsumerMeta(key, value string) ConsumerOption  // transport hints
```

### Publish options

```go
type PublishOption func(*publishConfig)

func ToTopic(topic string) PublishOption
func WithMessageID(id string) PublishOption          // default: generated
func WithCorrelationID(id string) PublishOption
func WithHeader(key, value string) PublishOption     // carried on the wire
func Meta(key, value string) PublishOption           // transport hints, not serialized
```

### Retry and dead-lettering

```go
type RetryPolicy struct {
	MaxAttempts  int           // total attempts incl. the first; 0 => 1
	InitialDelay time.Duration
	MaxDelay     time.Duration
	Factor       float64
}

const (
	DefaultRetryInitialDelay = 100 * time.Millisecond
	DefaultRetryMaxDelay     = 10 * time.Second
	DefaultRetryFactor       = 2.0
)

type ExhaustedAction int

const (
	ExhaustedDeadLetter ExhaustedAction = iota
	ExhaustedRequeue
	ExhaustedDrop
)

// Headers stamped onto dead-lettered envelopes.
const (
	HeaderError       = "smsg-error"
	HeaderAttempts    = "smsg-attempts"
	HeaderOriginTopic = "smsg-origin-topic"
)
```

### Envelope and serialization

```go
type Envelope struct {
	MessageID     string
	CorrelationID string
	MessageType   string
	ContentType   string
	Topic         string
	Timestamp     time.Time
	Headers       map[string]string // on the wire
	Metadata      map[string]string // transport hints, not serialized
	Body          []byte
}

func (e *Envelope) Clone() *Envelope // deep copy

type Delivery struct {
	Envelope *Envelope
	Attempt  int // transport-level redelivery count, 0 when unknown
}

type Serializer interface {
	ContentType() string
	Serialize(v any) ([]byte, error)
	Deserialize(data []byte, v any) error
}

func JSON() Serializer

type TopicNamer func(t reflect.Type) string
func DefaultTopicNamer(t reflect.Type) string // the plain type name
```

### Transport SPI

Implemented by `inmem`, `rabbit` and `kafka`; implement it to add a broker.

```go
type Transport interface {
	Name() string
	Connect(ctx context.Context) error
	Publish(ctx context.Context, topic string, env *Envelope) error
	Subscribe(ctx context.Context, spec SubscriptionSpec, h DeliveryHandler) (Subscription, error)
	Close(ctx context.Context) error
}

// nil => success (transport must ack/commit); non-nil => the bus could
// neither handle nor dead-letter; the transport applies redelivery.
type DeliveryHandler func(ctx context.Context, d *Delivery) error

type SubscriptionSpec struct {
	Topic       string
	Group       string
	Concurrency int
	Metadata    map[string]string
}

type Subscription interface {
	Close(ctx context.Context) error // stop fetching, drain in-flight
	Done() <-chan struct{}
	Err() error // nil after Close, non-nil after an abnormal end
}
```

### Logging and observing

```go
type Logger interface {
	Debug(template string, args ...any)
	Information(template string, args ...any)
	Warning(template string, args ...any)
	Error(err error, template string, args ...any)
}

func SlogLogger(l *slog.Logger) Logger

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

### Errors

```go
var (
	ErrNotStarted = errors.New("smsg: bus not started")
	ErrStopped    = errors.New("smsg: bus stopped")
	ErrNoTopic    = errors.New("smsg: no topic resolved for message")
)
```

## Package smsg/inmem

```go
const DefaultBuffer = 128

func New(opts ...Option) *Transport            // private broker
func NewBroker() *Broker
func (b *Broker) Transport(opts ...Option) *Transport

type Option func(*Transport)
func WithBuffer(n int) Option                  // per-(topic, group) queue capacity
```

## Package smsg/smsgtest

```go
const DefaultTimeout = 10 * time.Second

func Start(t testing.TB, b *smsg.Builder) *Bus
func (b *Bus) Bus() *smsg.Bus
func (b *Bus) Publish(msg any, opts ...smsg.PublishOption)
func (b *Bus) Wait() error
func (b *Bus) Stop() error

func NewCollector[T any]() *Collector[T]
func (c *Collector[T]) Registration() smsg.ConsumerRegistration
func (c *Collector[T]) Messages() []smsg.Message[T]
func (c *Collector[T]) Wait(t testing.TB, n int) []smsg.Message[T]

func NewRecorder() *Recorder
func (r *Recorder) Observer() smsg.Observer
func (r *Recorder) Events() []Event
func (r *Recorder) Has(kind string) bool
func (r *Recorder) WaitFor(t testing.TB, kind string, n int) []Event

type Event struct {
	Kind      string
	Topic     string
	Group     string
	MessageID string
	Attempt   int
	Err       error
}

// Event kinds.
const (
	BusStarted          = "bus-started"
	BusStopped          = "bus-stopped"
	SubscriptionStarted = "subscription-started"
	SubscriptionStopped = "subscription-stopped"
	Published           = "published"
	Consumed            = "consumed"
	RetryScheduled      = "retry-scheduled"
	DeadLettered        = "dead-lettered"
	Dropped             = "dropped"
)
```

## Package smsg/rabbit (separate module)

```go
const DefaultDialTimeout = 10 * time.Second

type Config struct {
	URL         string
	Durable     *bool         // default true
	Prefetch    int           // default: the subscription's Concurrency
	DialTimeout time.Duration // default 10s
	TLS         *tls.Config
}

func New(cfg Config, opts ...Option) *Transport
type Option func(*Transport)
func WithName(name string) Option

// Typed sugar over core metadata options.
func Exchange(name string) smsg.ConsumerOption
func ExchangeType(kind string) smsg.ConsumerOption
func BindingKey(key string) smsg.ConsumerOption
func RoutingKey(key string) smsg.PublishOption
func PublishExchangeType(kind string) smsg.PublishOption

const (
	MetaExchange     = "rabbit.exchange"
	MetaExchangeType = "rabbit.exchange-type"
	MetaBindingKey   = "rabbit.binding-key"
	MetaRoutingKey   = "rabbit.routing-key"
)
```

## Package smsg/kafka (separate module)

```go
type Config struct {
	Brokers          []string
	ClientID         string      // default "smsg"
	TLS              *tls.Config
	AutoCreateTopics bool
	Opts             []kgo.Opt   // escape hatch (SASL, timeouts, ...)
}

func New(cfg Config, opts ...Option) *Transport
type Option func(*Transport)
func WithName(name string) Option

// Typed sugar over core metadata options.
func PartitionKey(key string) smsg.PublishOption
func StartOffsetFirst() smsg.ConsumerOption
func StartOffsetLast() smsg.ConsumerOption

const (
	MetaPartitionKey = "kafka.partition-key"
	MetaStartOffset  = "kafka.start-offset"
)
```
