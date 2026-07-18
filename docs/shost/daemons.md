# Running as a daemon

shost ships the pieces needed to run a host under a service manager: systemd integration (`sdnotify`), a Windows service bridge (`winsvc`), a single-instance lock (`single`), and the [reload hook](./services.md#reload) they plug into. `sdnotify` and `single` are part of the core module (standard library only); `winsvc` is a separate module.

## systemd (sdnotify)

`shost/sdnotify` speaks the sd_notify protocol for `Type=notify` units: readiness, stopping status, and watchdog keep-alives. Everything is a **no-op when `NOTIFY_SOCKET` is unset**, so the same binary works as a unit, in a container, and from a terminal.

```go
host := sdnotify.Bind(shost.New().
	AddService(worker)).
	MustBuild()
host.Run()
```

`Bind` wires notifications into the lifecycle: `READY=1` on `OnStarted` (systemd considers the service started only then), `STOPPING=1` on `OnStopping`, and — when the unit sets `WatchdogSec=` — an internal `"sdnotify-watchdog"` service pinging at half the configured interval.

```go
var ErrNotAvailable = errors.New("sdnotify: NOTIFY_SOCKET is not set")

func Available() bool
func Notify(state string) error // raw sd_notify string; most callers use the helpers
func Ready() error              // READY=1
func Stopping() error           // STOPPING=1
func Status(msg string) error   // STATUS=... shown by systemctl status
func Watchdog() error           // WATCHDOG=1
func WatchdogEnabled() (time.Duration, bool)
func Bind(b *shost.Builder) *shost.Builder
```

`WatchdogEnabled` reads `WATCHDOG_USEC`/`WATCHDOG_PID` and reports false when the PID doesn't match the process.

### Generating a unit file

`Unit` renders a `Type=notify` unit as a starting point for installers:

```go
type UnitConfig struct {
	Description      string
	ExecStart        string // required
	User             string
	WorkingDirectory string
	Environment      []string      // KEY=value pairs
	WatchdogSec      time.Duration // pair with Bind, which starts the pinger
	TimeoutStopSec   time.Duration // zero keeps the systemd default (90s)
}

func Unit(cfg UnitConfig) string
```

The generated unit includes `After=network.target`, `Restart=on-failure`, and `WantedBy=multi-user.target`. Two things to align:

- `TimeoutStopSec` should be at least the host's `WithShutdownTimeout`, so systemd waits for the drain.
- `Restart=on-failure` complements [restart policies](./restart-policies.md): `WithRestart` supervises individual services *inside* the process; systemd restarts the process itself.

## Windows service (winsvc)

`go get github.com/dvislobokov/shost/winsvc` — separate module (depends on `golang.org/x/sys`), the analog of `Microsoft.Extensions.Hosting.WindowsServices`.

A binary started by the Service Control Manager must speak the SCM protocol within ~30 seconds or the start fails with error 1053 — and SCM sends control codes, not signals, so the host's SIGTERM handling never fires. `winsvc.Run` bridges the two worlds:

```go
func main() {
	b := shost.New().
		AddService(worker).
		OnReload(reloadConfig)
	if err := winsvc.Run(b, winsvc.WithName("my-agent")); err != nil {
		os.Exit(1)
	}
}
```

Under SCM the service reports `START_PENDING` while startup tasks and services come up, `RUNNING` once the host reports started; `Stop`/`Shutdown` controls trigger graceful shutdown with `STOP_PENDING` checkpoints advancing while services drain (the wait hint is derived from `Host.ShutdownTimeout()`), and `PARAMCHANGE` (`sc control my-agent paramchange`) invokes `Host.Reload`. Startup and shutdown errors go to the Windows Event Log.

Outside SCM — a terminal, a container, any other OS — `Run` falls back to plain `Host.Run`, so the same binary works everywhere (on Unix that means SIGTERM plus SIGHUP→Reload apply).

```go
func IsWindowsService() bool // false outside SCM and on non-Windows
func Run(b *shost.Builder, opts ...Option) error

type Option func(*options)
func WithName(name string) Option // default: executable name without extension; must match the install name

type InstallConfig struct {
	DisplayName      string   // shown in services.msc; defaults to the service name
	Description      string
	Args             []string // appended to the command line on every start
	Manual           bool     // manual start instead of automatic
	DelayedAutoStart bool     // ignored when Manual
}

func Install(name, exePath string, cfg InstallConfig) error // run elevated; also creates the Event Log source
func Uninstall(name string) error
```

`Install`/`Uninstall` are typically wired to `install`/`uninstall` CLI flags and run elevated; on non-Windows platforms they return a "only available on Windows" error.

## Single-instance lock (single)

`shost/single` guarantees one running instance of an application per machine — a common requirement for system agents, where a second copy means duplicated metrics and port conflicts.

```go
lock, err := single.Acquire(single.DefaultPath("my-agent"))
if errors.Is(err, single.ErrAlreadyRunning) {
	fmt.Fprintln(os.Stderr, "my-agent is already running")
	os.Exit(1)
}
defer lock.Release()
```

```go
var ErrAlreadyRunning = errors.New("single: another instance is already running")

func Acquire(path string) (*Lock, error) // never blocks; ErrAlreadyRunning (wrapped) when held
func (l *Lock) Release() error
func (l *Lock) Path() string
func DefaultPath(name string) string // os.TempDir()/<name>.lock
```

The lock is tied to the process — `flock` on Unix, an exclusive file handle on Windows — so the OS releases it even on a crash; there is no stale-pidfile handling to write. The PID is written into the file purely for humans inspecting it; the handle is the lock. `Release` closes the handle but leaves the file in place (removing it would race with a concurrent `Acquire`). Take the lock in `main`, before building the host; agents running as root/SYSTEM may prefer an explicit path like `/run/<name>.lock` over `DefaultPath`.
