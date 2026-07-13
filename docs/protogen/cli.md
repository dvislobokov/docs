# CLI reference

```txt
protogenall [flags] <proto files | directories | globs>
```

## Flags

| Flag | Default | Description |
|---|---|---|
| `--proto_path` | `.` | import root (repeatable), like `protoc -I` |
| `--out` | `gen` | output directory |
| `--go-package-prefix` | — | module prefix used to synthesize `go_package` when a proto omits it |
| `--proto-package` | — | override an empty proto `package` on target files |
| `--generators` | all | comma-separated subset of `messages,grpc,gateway,openapiv3` |
| `--openapi-title` | `API` | OpenAPI document title |
| `--openapi-version` | `0.0.1` | OpenAPI document version |
| `--openapi-enum-format` | `string` | enum representation: `string` (value names, matches grpc-gateway JSON) or `number` |
| `--descriptor-set-out` | — | also write a `FileDescriptorSet` (buf image) to this path |
| `--config` | — | path to a `protogenall.yaml` (auto-detected in the CWD if present) |
| `--list-builtins` | — | print the proto import paths bundled in this binary and exit |
| `--version` | — | print version and exit |

## Inputs

Positional arguments are files, directories (walked recursively for `*.proto`), or globs. Each is resolved to a name relative to one of the `--proto_path` roots. Inputs may also be supplied via `inputs:` in the config file.

## Bundled imports

These resolve without being on `--proto_path`:

```sh
$ protogenall --list-builtins
bundled imports (no --proto_path needed):
  buf/validate/validate.proto
  google/api/annotations.proto
  google/api/field_behavior.proto
  google/api/http.proto
```

Plus all `google/protobuf/*` well-known types.

## Output files

For each generated proto (with `paths=source_relative`, mirroring the source tree):

| File | When |
|---|---|
| `<name>.pb.go` | `messages` |
| `<name>_grpc.pb.go` | `grpc`, if the file has services |
| `<name>.pb.gw.go` | `gateway`, if a method has a `google.api.http` binding |
| `openapi.yaml` | `openapiv3` (one per run) |

## Version

`--version` prints the ldflags-injected version if set, otherwise the module version recorded by `go install`:

```sh
$ protogenall --version
protogenall v0.0.0-20260712114613-21ca0ced2c0b
```

## Runtime helpers

Two small packages accompany the generated code (imported by your service, not produced by the generator):

- **`github.com/dvislobokov/protogen/rest`** — `ValidationInterceptor` and `ProblemErrorHandler` for ASP.NET Core-style `problem+json` validation errors. See [Validation and OpenAPI](./validation.md).
- **`github.com/dvislobokov/protogen/grpcx`** — `Register(s)` adds server reflection and the health service in one call.

```go
s := grpc.NewServer()
shop.RegisterCheckoutServer(s, impl{})
grpcx.Register(s) // reflection + health, marked SERVING
```
