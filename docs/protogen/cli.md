# CLI reference

```txt
protogenall [flags] <proto files | directories | globs>
protogenall <project dir>        # a directory holding protogenall.yaml
protogenall init [--force] [dir] # scaffold a new project
```

## Subcommands

### `init`

Scaffolds a ready-to-generate project: `proto/<name>/v1/<name>.proto` (with `google.api.http`, `buf.validate`, `openapi.v3` and `protogen.authz` annotations wired up) and a `protogenall.yaml`. The project name and `go_package_prefix` come from `go.mod` when present. Existing files are skipped unless `--force` is given. See [Scaffolding](./scaffolding.md).

```sh
protogenall init myapi
protogenall myapi        # generate it
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

A single directory argument that contains a `protogenall.yaml` is treated as a **project root**: protogenall switches into it and generates using that config — equivalent to `cd <dir> && protogenall`.

## Bundled imports

These resolve without being on `--proto_path`:

```sh
$ protogenall --list-builtins
bundled imports (no --proto_path needed):
  buf/validate/validate.proto
  google/api/annotations.proto
  google/api/field_behavior.proto
  google/api/http.proto
  openapiv3/OpenAPIv3.proto
  openapiv3/annotations.proto
  protogen/authz/authz.proto
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
protogenall v1.0.0
```

## Runtime helpers

Three small packages accompany the generated code (imported by your service, not produced by the generator):

- **`github.com/dvislobokov/protogen/rest`** — `ValidationInterceptor` and `ProblemErrorHandler` for ASP.NET Core-style `problem+json` validation errors. See [Validation and OpenAPI](./validation.md).
- **`github.com/dvislobokov/protogen/grpcx`** — `Register(s)` adds server reflection and the health service in one call.
- **`github.com/dvislobokov/protogen/authz`** — `UnaryServerInterceptor`/`StreamServerInterceptor` (and `Authorize`) enforcing `(protogen.authz.requires)` roles/permissions. See [Roles and permissions](./authz.md).

```go
s := grpc.NewServer()
shop.RegisterCheckoutServer(s, impl{})
grpcx.Register(s) // reflection + health, marked SERVING
```
