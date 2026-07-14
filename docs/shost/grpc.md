# gRPC and grpc-gateway

Two separate Go modules wrap gRPC servers and grpc-gateway REST frontends as shost services:

```sh
go get github.com/dvislobokov/shost/grpcsvc  # gRPC server
go get github.com/dvislobokov/shost/grpcgw   # grpc-gateway (REST → gRPC transcoding)
```

They live outside the core module so that `shost` itself stays dependency-free; both require Go 1.25 or newer.

## gRPC server (grpcsvc)

`grpcsvc.New` runs a `*grpc.Server` with the full shost lifecycle: readiness once the listener accepts, graceful stop under the host's shutdown deadline, forceful stop when the deadline expires.

```go
srv := grpc.NewServer()
pb.RegisterGreeterServer(srv, &greeter{})

host := shost.New().
	AddService(grpcsvc.New(":9090", srv)).
	MustBuild()
```

```go
func New(addr string, srv *grpc.Server, opts ...Option) *Service // panics on nil server
func WithName(name string) Option // default "grpc <addr>"

func (s *Service) Name() string
func (s *Service) Ready() <-chan struct{} // closes once the listener accepts
func (s *Service) Addr() string           // actual address (useful with ":0"); "" before ready
func (s *Service) Start(ctx context.Context) error
func (s *Service) Stop(ctx context.Context) error
```

Register your gRPC services on `srv` *before* passing it in. `Stop` runs `GracefulStop` bounded by the shared shutdown deadline; if in-flight RPCs don't drain in time, the server is stopped forcefully and `Stop` returns a "graceful shutdown timed out" error wrapping `ctx.Err()`. `grpc.ErrServerStopped` is treated as a clean exit.

## grpc-gateway (grpcgw)

`grpcgw` runs a [grpc-gateway](https://github.com/grpc-ecosystem/grpc-gateway) HTTP server — REST→gRPC transcoding — as a shost service, owning the boilerplate: `runtime.ServeMux` construction, the client connection to the gRPC endpoint, handler registration, and the HTTP server lifecycle.

```go
gw := grpcgw.New(":8081", "localhost:9090",
	grpcgw.Register(pb.RegisterGreeterHandler),
	grpcgw.Register(pb.RegisterOrdersHandler),
)

host := shost.New().
	AddService(grpcsvc.New(":9090", grpcServer)).
	AddService(gw). // starts after the gRPC server is ready
	MustBuild()
```

```go
type RegisterFunc func(ctx context.Context, mux *runtime.ServeMux, conn *grpc.ClientConn) error

func New(addr, endpoint string, opts ...Option) *Service // panics without at least one Register
func Register(fn RegisterFunc) Option                    // protoc-generated RegisterXxxHandler; at least one required
func WithName(name string) Option                        // default "grpc-gateway <addr>"
func WithServeMuxOptions(opts ...runtime.ServeMuxOption) Option
func WithDialOptions(opts ...grpc.DialOption) Option     // replaces the default insecure credentials
func WithServer(configure func(*http.Server)) Option     // timeouts, TLS, ...
func WithHandler(wrap func(http.Handler) http.Handler) Option // middleware: logging, CORS, auth

func (s *Service) Name() string
func (s *Service) Ready() <-chan struct{}
func (s *Service) Addr() string
func (s *Service) Start(ctx context.Context) error
func (s *Service) Stop(ctx context.Context) error
```

Details worth knowing:

- The connection to `endpoint` is **plaintext by default** — the usual same-host gateway setup. `WithDialOptions` *replaces* the defaults, so supply your own transport credentials when the gRPC server is remote or TLS-terminated.
- `Ready` closes after all `Register` functions have run and the listener accepts, so ordering the gateway after the gRPC server in the builder gives a fully wired pipeline before the host reports started.
- `Stop` uses `http.Server.Shutdown` under the shared deadline, then forceful `Close` with a wrapped error if the deadline expires — same contract as [httpsvc](./http.md).
