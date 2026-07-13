# Health checks

`shost/health` provides a `Checker` registry with liveness (`/healthz`) and readiness (`/readyz`) HTTP handlers for Kubernetes probes. Readiness is wired to the host lifecycle so a service reports "not ready" until it's actually up and again while it's shutting down.

```go
import "github.com/dvislobokov/shost/health"

reg := health.NewRegistry(
	health.CheckerFunc("db", db.Ping),
	health.CheckerFunc("cache", cache.Ping),
)
reg.Mount(mux) // registers /healthz and /readyz

host := shost.New().
	AddService(httpsvc.New(":8080", mux)).
	OnStarted(func()  { reg.SetReady(true) }).
	OnStopping(func() { reg.SetReady(false) }).
	MustBuild()
```

## API

```go
type Checker interface {
	Name() string
	Check(ctx context.Context) error // nil == healthy
}

func CheckerFunc(name string, fn func(ctx context.Context) error) Checker

func NewRegistry(checkers ...Checker) *Registry   // readiness starts false

func (r *Registry) Add(c Checker)              // concurrent-safe
func (r *Registry) SetReady(v bool)
func (r *Registry) Ready() bool
func (r *Registry) LiveHandler() http.Handler  // 200 if all checks pass, else 503
func (r *Registry) ReadyHandler() http.Handler // 200 only if ready AND all checks pass
func (r *Registry) Mount(mux *http.ServeMux)   // /healthz -> Live, /readyz -> Ready
```

## Liveness vs readiness

- **`/healthz` (liveness)** — returns `200` when every registered check passes, `503` otherwise. Kubernetes restarts the pod on repeated failures. Keep these checks about "is the process healthy," not "are dependencies up."
- **`/readyz` (readiness)** — returns `200` only when the readiness flag is set **and** all checks pass. Kubernetes routes traffic based on this. The flag is yours to control via `SetReady`, typically from `OnStarted` / `OnStopping`.

The registry starts **not ready**, so a pod won't receive traffic until `OnStarted` flips it — and stops receiving traffic the moment `OnStopping` clears it, before the server actually drains.

## Response format

Both handlers return JSON:

```json
{ "status": "ok", "checks": { "db": "ok", "cache": "ok" } }
```

On failure the overall `status` is `"unhealthy"` and the failing check carries its error message:

```json
{ "status": "unhealthy", "checks": { "db": "connection refused", "cache": "ok" } }
```

Checks receive a `context.Context` and should honor its deadline.
