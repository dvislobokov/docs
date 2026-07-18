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
func (b *Builder) AddStartupTask(name string, fn func(ctx context.Context) error) *Builder
func (b *Builder) OnStarted(fn func()) *Builder
func (b *Builder) OnStopping(fn func()) *Builder
func (b *Builder) OnStopped(fn func()) *Builder
func (b *Builder) OnReload(fn func()) *Builder
func (b *Builder) WithObserver(o Observer) *Builder
func (b *Builder) Build() (*Host, error)
func (b *Builder) MustBuild() *Host
```

Build errors are accumulated and joined by `Build` (nil logger, empty environment, non-positive timeouts, nil service, empty/duplicate service name, empty startup-task name, nil task, nil hook, invalid restart policy). A nil logger becomes a silent no-op; an empty environment becomes `Production`.

Startup tasks run sequentially before any service starts; a failing task aborts the host. `OnReload` hooks run on `Host.Reload()`. See [Services and lifecycle](./services.md).

```go
const DefaultShutdownTimeout = 30 * time.Second
```

### Host

```go
func (h *Host) Run() error                            // SIGINT/SIGTERM handling (+ SIGHUP→Reload on Unix), blocks
func (h *Host) RunContext(ctx context.Context) error  // caller-provided shutdown, no OS signals
func (h *Host) Shutdown()                              // idempotent, non-blocking, goroutine-safe
func (h *Host) Reload()                                // run OnReload hooks; concurrent calls serialized
func (h *Host) Environment() Environment
func (h *Host) ShutdownTimeout() time.Duration         // configured graceful-shutdown bound
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

### Logging adapters

```go
func SlogLogger(l *slog.Logger) Logger // adapt log/slog; panics on nil
```

Renders `{Name}` templates into the message and adds each matched placeholder as a slog attribute; `Error` appends an `error` attribute. See [Services and lifecycle](./services.md#logging).

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
func At(name string, schedule Schedule, job Job, opts ...Option) *Service

type Schedule interface {
	Next(after time.Time) time.Time
}
type ScheduleFunc func(after time.Time) time.Time
func (f ScheduleFunc) Next(after time.Time) time.Time

func Expr(spec string) (Schedule, error) // 5-field cron expression (+ @hourly etc.)
func MustExpr(spec string) Schedule      // panics on a malformed expression

func RunImmediately() Option
func StopOnError() Option
func WithErrorHandler(fn func(error)) Option
func WithJitter(d time.Duration) Option     // random delay in [0, d) per run
func WithRunTimeout(d time.Duration) Option // per-run context.WithTimeout
```

See [Cron jobs](./cron.md) for expression syntax and scheduling semantics.

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
func (r *Registry) Mount(mux *http.ServeMux, opts ...MountOption)

func WithLivePath(path string) MountOption   // default "/healthz"
func WithReadyPath(path string) MountOption  // default "/readyz"
```

## `shost/swaggerui`

Part of the core module; standard library only. Bundled Swagger UI (swagger-ui-dist embedded via `go:embed`, works offline). See [HTTP Services](./http.md#swagger-ui).

```go
func Handler(opts ...Option) http.Handler                     // mount-point relative
func Mount(mux *http.ServeMux, prefix string, opts ...Option) // Handle(prefix, StripPrefix(...))

func WithSpec(name string, spec []byte) Option // serve + load ./name; repeatable
func WithSpecURL(url string) Option            // load an external document; repeatable
func WithTitle(title string) Option            // default "Swagger UI"
```

## `shost/shosttest`

Part of the core module; standard library only. See [Testing](./testing.md).

```go
const DefaultTimeout = 10 * time.Second

type Host struct{ /* unexported */ }
func Start(t testing.TB, b *shost.Builder) *Host
func (h *Host) Host() *shost.Host
func (h *Host) Shutdown()   // non-blocking; pair with Wait
func (h *Host) Wait() error // blocks until Run returns; fails the test after DefaultTimeout
func (h *Host) Stop() error // Shutdown + Wait

const (
	HostStarted       = "HostStarted"
	HostStopped       = "HostStopped"
	ServiceStarted    = "ServiceStarted"
	ServiceReady      = "ServiceReady"
	ServiceRestarting = "ServiceRestarting"
	ServiceStopped    = "ServiceStopped"
	ServiceFailed     = "ServiceFailed"
)

type Event struct {
	Kind    string
	Service string
	Err     error
	Attempt int
	Delay   time.Duration
	Elapsed time.Duration
}

func NewRecorder() *Recorder
func (r *Recorder) Observer() shost.Observer
func (r *Recorder) Events() []Event
func (r *Recorder) Has(kind, service string) bool
func (r *Recorder) WaitFor(kind, service string, timeout time.Duration) bool
```

## `shost/grpcsvc` (separate module)

```go
func New(addr string, srv *grpc.Server, opts ...Option) *Service // panics on nil server
func WithName(name string) Option // default "grpc <addr>"

func (s *Service) Name() string
func (s *Service) Ready() <-chan struct{} // closes once the listener accepts
func (s *Service) Addr() string           // actual address; "" before ready
func (s *Service) Start(ctx context.Context) error
func (s *Service) Stop(ctx context.Context) error // GracefulStop, forceful on deadline
```

## `shost/grpcgw` (separate module)

```go
type RegisterFunc func(ctx context.Context, mux *runtime.ServeMux, conn *grpc.ClientConn) error

func New(addr, endpoint string, opts ...Option) *Service // at least one Register required
func Register(fn RegisterFunc) Option
func WithName(name string) Option // default "grpc-gateway <addr>"
func WithServeMuxOptions(opts ...runtime.ServeMuxOption) Option
func WithDialOptions(opts ...grpc.DialOption) Option // replaces default insecure creds
func WithServer(configure func(*http.Server)) Option
func WithHandler(wrap func(http.Handler) http.Handler) Option

func (s *Service) Name() string
func (s *Service) Ready() <-chan struct{}
func (s *Service) Addr() string
func (s *Service) Start(ctx context.Context) error
func (s *Service) Stop(ctx context.Context) error
```

See [gRPC and grpc-gateway](./grpc.md).

## `shost/sdnotify`

Part of the core module; standard library only. See [Running as a daemon](./daemons.md#systemd-sdnotify).

```go
var ErrNotAvailable = errors.New("sdnotify: NOTIFY_SOCKET is not set")

func Available() bool
func Notify(state string) error   // raw sd_notify string
func Ready() error                // READY=1
func Stopping() error             // STOPPING=1
func Status(msg string) error     // STATUS=...
func Watchdog() error             // WATCHDOG=1
func WatchdogEnabled() (time.Duration, bool)
func Bind(b *shost.Builder) *shost.Builder // READY/STOPPING hooks + watchdog service

type UnitConfig struct {
	Description      string
	ExecStart        string // required
	User             string
	WorkingDirectory string
	Environment      []string
	WatchdogSec      time.Duration
	TimeoutStopSec   time.Duration // zero keeps the systemd default (90s)
}
func Unit(cfg UnitConfig) string // render a Type=notify unit file
```

## `shost/single`

Part of the core module; standard library only. See [Running as a daemon](./daemons.md#single-instance-lock-single).

```go
var ErrAlreadyRunning = errors.New("single: another instance is already running")

type Lock struct{ /* unexported */ }
func Acquire(path string) (*Lock, error) // non-blocking; process-tied (flock / exclusive handle)
func (l *Lock) Release() error
func (l *Lock) Path() string
func DefaultPath(name string) string // os.TempDir()/<name>.lock
```

## `shost/winsvc` (separate module)

See [Running as a daemon](./daemons.md#windows-service-winsvc).

```go
func IsWindowsService() bool // false outside SCM and on non-Windows
func Run(b *shost.Builder, opts ...Option) error // SCM protocol under the SCM; Host.Run otherwise

type Option func(*options)
func WithName(name string) Option // default: executable name without extension

type InstallConfig struct {
	DisplayName      string
	Description      string
	Args             []string
	Manual           bool
	DelayedAutoStart bool // ignored when Manual
}
func Install(name, exePath string, cfg InstallConfig) error // elevated; creates Event Log source
func Uninstall(name string) error
```

## `shost/otel` (package `shostotel`, separate module)

```go
func NewObserver(opts ...Option) (shost.Observer, error)
func NewPrometheusHandler() (http.Handler, *sdkmetric.MeterProvider, error)

func WithMeterProvider(mp metric.MeterProvider) Option   // default otel.GetMeterProvider()
func WithTracerProvider(tp trace.TracerProvider) Option  // default otel.GetTracerProvider()
```

Emits `shost.host.up`, `shost.service.restarts`, `shost.service.failures`, `shost.service.stop.duration`, and a `shost.service.stop` span. See [Observability](./observability.md).
