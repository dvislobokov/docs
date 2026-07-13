# HTTP services

`shost/httpsvc` wraps a `net/http` server as a shost `Service`: it becomes ready once the listener accepts, and on shutdown it drains in-flight requests under the host deadline, forcing a close if the deadline expires.

```go
import "github.com/dvislobokov/shost/httpsvc"

mux := http.NewServeMux()
mux.HandleFunc("/hello", handler)

host := shost.New().
	AddService(httpsvc.New(":8080", mux, httpsvc.WithName("api"))).
	MustBuild()
```

Any `http.Handler` plugs in — the standard `ServeMux`, or a framework router (Echo, Gin, chi, …), since they all implement `http.Handler`.

## API

```go
func New(addr string, handler http.Handler, opts ...Option) *Service

func WithName(name string) Option                    // default: "http <addr>"
func WithServer(configure func(*http.Server)) Option // tweak timeouts / TLS / ErrorLog before start
```

The returned `*Service` also implements `Readier`, and exposes:

```go
func (s *Service) Addr() string   // actual listen address (useful with ":0"), "" before ready
func (s *Service) Ready() <-chan struct{}
```

## Readiness

`httpsvc` closes its `Ready()` channel once the listener is accepting connections. Because the host waits for a `Readier` service before launching the next one, anything registered after your HTTP server starts only once the server is actually listening.

Bind to `:0` and read `Addr()` after ready to discover the assigned port — handy in tests.

## Graceful shutdown

On shutdown, the service calls `http.Server.Shutdown` with the host's deadline context, letting in-flight requests finish. If the deadline expires first, it falls back to a forceful `Close`. Configure server timeouts with `WithServer`:

```go
httpsvc.New(":8080", mux, httpsvc.WithServer(func(s *http.Server) {
	s.ReadHeaderTimeout = 5 * time.Second
	s.IdleTimeout = 60 * time.Second
}))
```

## With health checks

Mount [health](./health.md) handlers on the same mux and flip readiness from the lifecycle:

```go
reg := health.NewRegistry(health.CheckerFunc("db", db.Ping))
reg.Mount(mux)

host := shost.New().
	AddService(httpsvc.New(":8080", mux)).
	OnStarted(func()  { reg.SetReady(true) }).
	OnStopping(func() { reg.SetReady(false) }).
	MustBuild()
```
