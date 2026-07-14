# Testing with shosttest

`shost/shosttest` (part of the core module, standard library only) runs a real host inside a test and gives you a ready-made `Observer` for asserting on lifecycle events.

## Running a host in a test

```go
func TestServer(t *testing.T) {
	h := shosttest.Start(t, shost.New().
		AddService(httpsvc.New(":0", mux)))

	// exercise the running services...

	if err := h.Stop(); err != nil {
		t.Fatal(err)
	}
}
```

```go
const DefaultTimeout = 10 * time.Second

func Start(t testing.TB, b *shost.Builder) *Host

func (h *Host) Host() *shost.Host
func (h *Host) Shutdown()   // non-blocking; pair with Wait
func (h *Host) Wait() error // blocks until Run returns; fails the test after DefaultTimeout
func (h *Host) Stop() error // Shutdown + Wait
```

`Start` builds the host, runs it in a goroutine, and blocks until every service is launched and ready. Build errors, startup failures, and a startup hanging beyond `DefaultTimeout` fail the test via `t.Fatalf`. A `t.Cleanup` stops the host automatically at the end of the test — call `Stop`/`Wait` explicitly only when you want to assert on the error `Run` returned (the result is buffered, so repeated `Wait` calls see the same error).

## Recording lifecycle events

`Recorder` is an [Observer](./observability.md) that captures events for assertions:

```go
rec := shosttest.NewRecorder()
h := shosttest.Start(t, shost.New().
	WithObserver(rec.Observer()).
	AddService(flaky, shost.WithRestart(shost.RestartPolicy{MaxAttempts: 3})))

if !rec.WaitFor(shosttest.ServiceRestarting, "flaky", time.Second) {
	t.Fatal("expected a restart")
}
```

```go
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
func (r *Recorder) Has(kind, service string) bool                       // service "" matches any
func (r *Recorder) WaitFor(kind, service string, timeout time.Duration) bool
```

The recorder is safe for concurrent use. `Has` checks the events captured so far; `WaitFor` polls until the event appears or the timeout elapses — the right tool for asynchronous events like `ServiceRestarting`.
