# API reference

Every exported symbol, grouped by package.

## `shost`

### Builder

```go
func New() *Builder

func (b *Builder) WithLogger(l Logger) *Builder
func (b *Builder) WithEnvironment(e Environment) *Builder      // default Production
func (b *Builder) WithShutdownTimeout(d time.Duration) *Builder // must be > 0; default 30s
func (b *Builder) WithStartTimeout(d time.Duration) *Builder    // must be > 0; unset => wait forever
func (b *Builder) AddService(s Service, opts ...ServiceOption) *Builder
func (b *Builder) OnStarted(fn func()) *Builder
func (b *Builder) OnStopping(fn func()) *Builder
func (b *Builder) OnStopped(fn func()) *Builder
func (b *Builder) WithObserver(o Observer) *Builder
func (b *Builder) Build() (*Host, error)
func (b *Builder) MustBuild() *Host
```

Build errors are accumulated and joined by `Build` (nil logger, empty environment, non-positive timeouts, nil service, empty/duplicate service name, nil hook, invalid restart policy). A nil logger becomes a silent no-op; an empty environment becomes `Production`.

```go
const DefaultShutdownTimeout = 30 * time.Second
```

### Host

```go
func (h *Host) Run() error                            // SIGINT/SIGTERM handling, blocks
func (h *Host) RunContext(ctx context.Context) error  // caller-provided shutdown, no OS signals
func (h *Host) Shutdown()                              // idempotent, non-blocking, goroutine-safe
func (h *Host) Environment() Environment
```

### Interfaces

```go
type Service interface {
	Name() string
	Start(ctx context.Context) error
	Stop(ctx context.Context) error
}

type Readier interface {
	Ready() <-chan struct{}
}

type Logger interface {
	Debug(template string, args ...any)
	Information(template string, args ...any)
	Warning(template string, args ...any)
	Error(err error, template string, args ...any)
}
```

### Service helpers and options

```go
func ServiceFunc(name string, run func(ctx context.Context) error) Service

type ServiceOption func(*registration)
func WithRestart(p RestartPolicy) ServiceOption
```

### RestartPolicy

```go
type RestartPolicy struct {
	MaxAttempts  int           // 0 = unlimited
	InitialDelay time.Duration // default 1s
	MaxDelay     time.Duration // default 1m
	Factor       float64       // default 2.0
	ResetAfter   time.Duration // default 1m
}

const (
	DefaultRestartInitialDelay = time.Second
	DefaultRestartMaxDelay     = time.Minute
	DefaultRestartFactor       = 2.0
	DefaultRestartResetAfter   = time.Minute
)
```

### Environment

```go
type Environment string

const (
	Development Environment = "Development"
	Staging     Environment = "Staging"
	Production  Environment = "Production"
)

const DefaultEnvironmentVar = "APP_ENVIRONMENT"

func EnvironmentFromEnv(varName string) Environment // "" => APP_ENVIRONMENT; unset => Production

func (e Environment) Is(other Environment) bool     // case-insensitive
func (e Environment) IsDevelopment() bool
func (e Environment) IsStaging() bool
func (e Environment) IsProduction() bool
func (e Environment) String() string
```

### Observer

```go
type Observer struct {
	HostStarted       func()
	HostStopped       func(err error)
	ServiceStarted    func(name string)
	ServiceReady      func(name string)
	ServiceRestarting func(name string, attempt int, delay time.Duration, err error)
	ServiceStopped    func(name string, elapsed time.Duration, err error)
	ServiceFailed     func(name string, err error)
}
```

> The package exports no sentinel `Err…` values; errors are constructed inline and prefixed `shost:`.

## `shost/httpsvc`

```go
func New(addr string, handler http.Handler, opts ...Option) *Service

func WithName(name string) Option                    // default "http <addr>"
func WithServer(configure func(*http.Server)) Option

func (s *Service) Name() string
func (s *Service) Ready() <-chan struct{}             // closes once listening
func (s *Service) Addr() string                       // actual addr, "" before ready
func (s *Service) Start(ctx context.Context) error
func (s *Service) Stop(ctx context.Context) error
```

## `shost/cron`

```go
type Job func(ctx context.Context) error

func Every(name string, interval time.Duration, job Job, opts ...Option) *Service

func RunImmediately() Option
func StopOnError() Option
func WithErrorHandler(fn func(error)) Option
```

## `shost/health`

```go
type Checker interface {
	Name() string
	Check(ctx context.Context) error
}

func CheckerFunc(name string, fn func(ctx context.Context) error) Checker

func NewRegistry(checkers ...Checker) *Registry

func (r *Registry) Add(c Checker)
func (r *Registry) SetReady(v bool)
func (r *Registry) Ready() bool
func (r *Registry) LiveHandler() http.Handler   // /healthz — 200 / 503
func (r *Registry) ReadyHandler() http.Handler  // /readyz — 200 only if ready + healthy
func (r *Registry) Mount(mux *http.ServeMux)
```

## `shost/otel` (package `shostotel`, separate module)

```go
func NewObserver(opts ...Option) (shost.Observer, error)
func NewPrometheusHandler() (http.Handler, *sdkmetric.MeterProvider, error)

func WithMeterProvider(mp metric.MeterProvider) Option   // default otel.GetMeterProvider()
func WithTracerProvider(tp trace.TracerProvider) Option  // default otel.GetTracerProvider()
```

Emits `shost.host.up`, `shost.service.restarts`, `shost.service.failures`, `shost.service.stop.duration`, and a `shost.service.stop` span. See [Observability](./observability.md).
