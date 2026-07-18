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

## Swagger UI

`shost/swaggerui` ships a fully bundled Swagger UI as a plain `http.Handler` — the swagger-ui-dist assets are embedded with `go:embed`, so it works offline, needs no CDN and no middleware. Mount it next to your API:

```go
import "github.com/dvislobokov/shost/swaggerui"

//go:embed openapi.json
var spec []byte

swaggerui.Mount(mux, "/swagger/",
	swaggerui.WithSpec("openapi.json", spec), // served by the handler itself
	swaggerui.WithTitle("Billing API"),
)
// GET /swagger/  → the UI, loading /swagger/openapi.json
```

The handler is relative to its mount point, so it also composes manually with any prefix:

```go
h := swaggerui.Handler(swaggerui.WithSpecURL("/api/openapi.json")) // spec served elsewhere
mux.Handle("/docs/", http.StripPrefix("/docs", h))
```

```go
func Handler(opts ...Option) http.Handler
func Mount(mux *http.ServeMux, prefix string, opts ...Option)

func WithSpec(name string, spec []byte) Option // serve + load ./name (.json/.yaml); repeatable
func WithSpecURL(url string) Option            // load an externally served document; repeatable
func WithTitle(title string) Option            // page title, default "Swagger UI"
```

Several `WithSpec`/`WithSpecURL` calls turn the UI's spec field into a drop-down selector.

## With health checks

Mount [health](./health.md) handlers on the same mux and flip readiness from the lifecycle:

```go
reg := health.NewRegistry(health.CheckerFunc("db", db.Ping))
reg.Mount(mux) // paths overridable: health.WithLivePath / health.WithReadyPath

host := shost.New().
	AddService(httpsvc.New(":8080", mux)).
	OnStarted(func()  { reg.SetReady(true) }).
	OnStopping(func() { reg.SetReady(false) }).
	MustBuild()
```
