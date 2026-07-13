# API Reference

Every exported symbol, grouped by package. The core package is `github.com/dvislobokov/srog`; integration subpackages follow.

## Package srog

### Constructors

```go
func New(opts ...Option) (*Logger, error)
```
Builds a logger from options. With no sink option it defaults to a single JSON sink on `os.Stdout` at `Information` level. Errors if a file sink cannot be opened.

```go
func MustNew(opts ...Option) *Logger
```
Like `New` but panics on error.

```go
func NewConsole() *Logger
```
Development preset: colorized console at `Debug` level with stack traces on errors.

### Logger

```go
type Logger struct{ /* unexported */ }
```
Immutable, concurrency-safe. The zero value is not usable — construct with `New`/`MustNew`.

```go
func (l *Logger) Verbose(tmpl string, args ...any)
func (l *Logger) Debug(tmpl string, args ...any)
func (l *Logger) Information(tmpl string, args ...any)
func (l *Logger) Info(tmpl string, args ...any)            // alias for Information
func (l *Logger) Warning(tmpl string, args ...any)
func (l *Logger) Error(err error, tmpl string, args ...any)
func (l *Logger) Fatal(err error, tmpl string, args ...any) // flushes sinks, then os.Exit(1)
```
Level methods. `tmpl` is a [message template](./message-templates.md); `args` fill its holes in order.

```go
func (l *Logger) ForContext(name string, value any) *Logger
func (l *Logger) ForContextValues(fields map[string]any) *Logger
func (l *Logger) Named(service string) *Logger              // ForContext("service", ...)
```
Derive enriched child loggers (see [Enrichment](./enrichment.md)).

```go
func (l *Logger) WithLevel(level Level) *Logger      // child with a different minimum level
func (l *Logger) WithStackTrace(on bool) *Logger     // child with stack capture toggled
func (l *Logger) Enabled(level Level) bool           // would events at level be emitted?
func (l *Logger) Close() error                       // release file/async sinks (root logger only)
func (l *Logger) IntoContext(ctx context.Context) context.Context
```

### Levels

```go
type Level int8

const (
	VerboseLevel     Level // zerolog Trace
	DebugLevel       Level
	InformationLevel Level
	WarningLevel     Level
	ErrorLevel       Level
	FatalLevel       Level
)

func ParseLevel(s string) (Level, error)
```
`ParseLevel` accepts `verbose`/`trace`, `debug`, `information`/`info`, `warning`/`warn`, `error`, `fatal` (case-insensitive).

### Logger options

```go
type Option func(*config)

func WithLevel(l Level) Option              // default minimum level (default Information)
func WithRenderedMessage(on bool) Option    // toggle the "message" field (default true)
func WithCaller(on bool) Option             // add "caller":"file:line"
func WithTimestamp(on bool) Option          // add "time" (default true)
func WithStackTrace(on bool) Option         // capture "stack" on Error/Fatal
func WithTimeFormat(layout string) Option   // per-logger timestamp layout
func WithErrorHandler(fn func(error)) Option // receive sink write failures
func WithSampling(s Sampler) Option         // flood control after level filtering
```

Sink-producing options:

```go
func WithConsole(opts ...SinkOption) Option           // console sink on os.Stdout
func WithFile(path string, opts ...SinkOption) Option  // JSON file sink
func WithWriter(w io.Writer, opts ...SinkOption) Option // sink on any io.Writer (JSON default)
```

### Sink options and formats

```go
type SinkOption func(*sinkConfig)

func MinLevel(l Level) SinkOption   // per-sink minimum level
func AsJSON() SinkOption
func AsConsole() SinkOption
func AsECS() SinkOption             // Elastic Common Schema NDJSON
func AsOTel() SinkOption            // OTLP/JSON log records
func NoColor() SinkOption           // disable ANSI colors (console)
func Rotate(r Rotation) SinkOption  // rotation for file sinks
func Async(bufferSize int) SinkOption // background writes; <=0 uses default 1024
```

```go
type Format uint8

const (
	FormatJSON    Format = iota
	FormatConsole
	FormatECS
	FormatOTel
)
```

### Rotation

```go
type Rotation struct {
	MaxSizeMB  int
	MaxBackups int
	MaxAgeDays int
	Compress   bool
	LocalTime  bool
	Every      Interval
}

type Interval uint8

const (
	NoInterval Interval = iota
	Hourly
	Daily
)
```
See [Rotation](./rotation.md).

### Sampling

```go
type Sampler = zerolog.Sampler

func EveryN(n uint32) Sampler
func BurstLimit(burst uint32, period time.Duration, next Sampler) Sampler
```
`EveryN` emits one of every `n` events. `BurstLimit` emits up to `burst` per `period`, deferring overflow to `next` (nil drops it).

### Time format constants

```go
const (
	TimeRFC3339     = time.RFC3339 // default
	TimeRFC3339Nano = time.RFC3339Nano
	TimeDateTime    = time.DateTime
	TimeDateOnly    = time.DateOnly
	TimeOnly        = time.TimeOnly
	TimeKitchen     = time.Kitchen

	TimeUnix      // epoch seconds (JSON number)
	TimeUnixMs    // epoch milliseconds
	TimeUnixMicro // epoch microseconds
	TimeUnixNano  // epoch nanoseconds
)
```

### Configuration

```go
type Config struct {
	Level      string     `json:"level,omitempty"`
	Render     *bool      `json:"render,omitempty"`
	Caller     bool       `json:"caller,omitempty"`
	Timestamp  *bool      `json:"timestamp,omitempty"`
	StackTrace bool       `json:"stackTrace,omitempty"`
	TimeFormat string     `json:"timeFormat,omitempty"`
	Sinks      []SinkSpec `json:"sinks,omitempty"`
}

type SinkSpec struct {
	Type     string        `json:"type"`               // console | file | stdout | stderr
	Target   string        `json:"target,omitempty"`   // console: stdout | stderr
	Path     string        `json:"path,omitempty"`     // file only
	Level    string        `json:"level,omitempty"`
	Format   string        `json:"format,omitempty"`   // json | console | ecs | otel
	NoColor  bool          `json:"noColor,omitempty"`
	Rotation *RotationSpec `json:"rotation,omitempty"`
}

type RotationSpec struct {
	MaxSizeMB  int    `json:"maxSizeMB,omitempty"`
	MaxBackups int    `json:"maxBackups,omitempty"`
	MaxAgeDays int    `json:"maxAgeDays,omitempty"`
	Compress   bool   `json:"compress,omitempty"`
	LocalTime  bool   `json:"localTime,omitempty"`
	Every      string `json:"every,omitempty"` // none | hourly | daily
}

func LoadConfig(r io.Reader) (Config, error)
func LoadConfigFile(path string) (Config, error)
func NewFromConfig(c Config) (*Logger, error)
func NewFromConfigFile(path string) (*Logger, error)
func (c Config) Build() (*Logger, error)
func (c Config) Options() ([]Option, error)
```
All structs also carry `yaml` tags. See [Configuration](./configuration.md) for the full schema.

### Context

```go
type Field struct {
	Name  string
	Value any
}
type ContextFieldFunc func(ctx context.Context) []Field

func AddContextField(fn ContextFieldFunc)                       // register an extractor (startup)
func NewContext(ctx context.Context, l *Logger) context.Context // store a logger in ctx
func FromContext(ctx context.Context) *Logger                   // stored logger or Default; never nil
func Ctx(ctx context.Context) *Logger                           // FromContext + extractor fields
```

### Global logger

```go
func Default() *Logger
func SetDefault(l *Logger) // atomic; safe under concurrency

func Verbose(tmpl string, args ...any)
func Debug(tmpl string, args ...any)
func Information(tmpl string, args ...any)
func Info(tmpl string, args ...any)
func Warning(tmpl string, args ...any)
func Error(err error, tmpl string, args ...any)
func Fatal(err error, tmpl string, args ...any)
func ForContext(name string, value any) *Logger

func VerboseCtx(ctx context.Context, tmpl string, args ...any)
func DebugCtx(ctx context.Context, tmpl string, args ...any)
func InformationCtx(ctx context.Context, tmpl string, args ...any)
func InfoCtx(ctx context.Context, tmpl string, args ...any)
func WarningCtx(ctx context.Context, tmpl string, args ...any)
func ErrorCtx(ctx context.Context, err error, tmpl string, args ...any)
func FatalCtx(ctx context.Context, err error, tmpl string, args ...any)
```
The `*Ctx` variants resolve the logger with `Ctx(ctx)`. The initial default is a JSON logger on stdout.

### Miscellaneous

```go
func NewID() string          // random 128-bit hex ID for request correlation
const StackFieldName = "stack" // field name for attached stack traces
```

## Package sroghttp

`github.com/dvislobokov/srog/sroghttp` — part of the main module.

```go
func Middleware(log *srog.Logger, opts ...Option) func(http.Handler) http.Handler

type Option func(*config)
func WithHeader(name string) Option           // request-ID header (default "X-Request-Id")
func WithField(name string) Option            // structured field name (default "RequestId")
func WithIDGenerator(fn func() string) Option // default srog.NewID
func WithSkip(fn func(*http.Request) bool) Option
func WithStartLog(on bool) Option             // also log when the request begins
```

## Package sroggrpc

`github.com/dvislobokov/srog/sroggrpc` — separate module.

```go
func UnaryServerInterceptor(log *srog.Logger, opts ...Option) grpc.UnaryServerInterceptor
func StreamServerInterceptor(log *srog.Logger, opts ...Option) grpc.StreamServerInterceptor

type Option func(*config)
func WithMetadataKey(key string) Option       // default "x-request-id"
func WithField(name string) Option            // default "RequestId"
func WithIDGenerator(fn func() string) Option // default srog.NewID
```

## Package srogecho

`github.com/dvislobokov/srog/srogecho` — separate module.

```go
func Middleware(log *srog.Logger, opts ...Option) echo.MiddlewareFunc
func Recover(log *srog.Logger) echo.MiddlewareFunc   // panic -> srog error with recover-time stack
func From(c echo.Context) *srog.Logger               // request-scoped logger; never nil

type Option func(*config)
func WithHeader(name string) Option            // default echo.HeaderXRequestID
func WithField(name string) Option             // default "RequestId"
func WithIDGenerator(fn func() string) Option
func WithSkip(fn func(echo.Context) bool) Option
func WithStartLog(on bool) Option
```

## Package srogelastic

`github.com/dvislobokov/srog/srogelastic` — separate module.

```go
type Config struct {
	Addresses     []string      // required; round-robin
	Index         string        // required
	Username      string
	Password      string
	APIKey        string        // takes precedence over basic auth
	BatchSize     int           // default 500
	FlushInterval time.Duration // default 5s
	QueueSize     int           // default 10000
	MaxRetries    int           // default 3; 4xx never retried
	Timeout       time.Duration // default 30s
	OnError       func(error)
	Client        *http.Client
}

func New(cfg Config) (*Sink, error)

type Sink struct{ /* io.WriteCloser */ }
func (s *Sink) Write(p []byte) (int, error) // non-blocking enqueue
func (s *Sink) Close() error                // flush queue, report drops
func (s *Sink) Dropped() uint64
func (s *Sink) Failed() uint64

func WithElasticsearch(cfg Config) (srog.Option, *Sink, error) // WithWriter(sink, AsECS())
```

## Package srogotel

`github.com/dvislobokov/srog/srogotel` — separate module.

```go
func Install()                                    // register Fields with srog.AddContextField
func Fields(ctx context.Context) []srog.Field     // trace_id + span_id of the active span
```

## Field name reference

Fields srog itself writes into JSON events:

| Field | Written by |
| --- | --- |
| `level` | every event |
| `time` | `WithTimestamp` (default on) |
| `@mt` | every event — the raw template |
| `message` | `WithRenderedMessage` (default on) |
| `error` | `Error`/`Fatal` with a non-nil error |
| `stack` | `WithStackTrace` on logged errors (`srog.StackFieldName`) |
| `caller` | `WithCaller` |
| `extra_N` | surplus arguments beyond the template's holes |
| hole names / positions | template arguments |
