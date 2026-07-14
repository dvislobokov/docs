# protogen

protogen is a single Go binary that generates protobuf **messages**, **gRPC** server/client stubs, a **gRPC-gateway** reverse proxy, and an **OpenAPI v3** document from `.proto` files — **without `protoc`, `protoc-gen-go`, or any external plugin**. Every stage runs in-process.

## Why protogen

- **Nothing to install.** `protoc` is a C++ toolchain and its plugins are separate binaries you have to put on your `PATH`. protogen replaces that whole pipeline with pure-Go code: parsing is done by [`bufbuild/protocompile`](https://github.com/bufbuild/protocompile), and every generator runs in the same process.
- **The real message generator.** Messages are produced by the exact code `protoc-gen-go` uses (`internal_gengo`), imported directly — so `*.pb.go` is byte-for-byte what you already expect.
- **gRPC with full streaming.** Unary plus server-, client-, and bidirectional streaming, modeled on `protoc-gen-go-grpc`'s modern generics output.
- **gRPC-gateway in-process.** A REST↔gRPC reverse proxy (`*.pb.gw.go`) for unary and server-streaming methods, honoring `google.api.http`.
- **OpenAPI v3 that matches reality.** Generated via [`google/gnostic`](https://github.com/google/gnostic), then enriched from your [protovalidate](https://github.com/bufbuild/protovalidate) constraints — `minLength`, `pattern`, `format`, string `enum`, `readOnly`/`writeOnly`, `required` — and a documented `400` `problem+json` response.
- **Runtime validation, no generated validator.** protovalidate checks messages via reflection at runtime; the constraints ride along in the descriptors.
- **OpenAPI annotations in the proto.** `openapi.v3.document/operation/schema/property` options set document info, operation summaries/tags, and schema overrides right where the API is defined.
- **Roles & permissions per method.** Annotate RPCs with `(protogen.authz.requires)` (`any_of`/`all_of`/`none_of` rules) and enforce them with the bundled gRPC interceptors — failures map to 401/403 through the gateway.
- **Bundled well-known imports.** `google/api/*` (incl. `field_behavior`), `buf/validate/*`, `openapiv3/*` and `protogen/authz/*` are embedded in the binary — no vendoring, no `--proto_path` for them.
- **Managed mode & monorepos.** Synthesizes `go_package`/`package` when your protos omit them, and generates a whole directory tree (or glob) in one call.
- **Project scaffolding.** `protogenall init` writes a starter proto (with all annotations wired up) and a config; after that a bare `protogenall` — or `protogenall <dir>` — generates everything.

## Installation

```sh
go install github.com/dvislobokov/protogen/cmd/protogenall@latest
protogenall --version
```

Requires Go 1.25 or newer.

## The fastest start

```sh
protogenall init myapi     # starter proto + protogenall.yaml
protogenall myapi          # → myapi/gen/… (*.pb.go, *_grpc.pb.go, *.pb.gw.go, openapi.yaml)
```

See [Scaffolding](./scaffolding.md) for what `init` creates.

## A minimal example

Given `greeter.proto` (note: **no** `option go_package`, and a REST mapping):

```proto
syntax = "proto3";
package greeter.v1;

import "google/api/annotations.proto";

service Greeter {
  rpc SayHello(HelloRequest) returns (HelloReply) {
    option (google.api.http) = { post: "/v1/greeter/hello" body: "*" };
  }
}

message HelloRequest { string name = 1; }
message HelloReply   { string message = 1; }
```

Generate everything:

```sh
protogenall \
  --proto_path=. \
  --go-package-prefix=example.com/gen \
  --openapi-title="Greeter API" \
  --out=gen \
  greeter.proto
```

```txt
compiling 1 proto file(s) with bufbuild/protocompile (no protoc)...
generating:
  wrote gen/greeter.pb.go
  wrote gen/greeter_grpc.pb.go
  wrote gen/greeter.pb.gw.go
  wrote gen/openapi.yaml
```

`google/api/annotations.proto` resolved from the binary — you never had to vendor it or add it to `--proto_path`. And because the proto declared no `go_package`, [managed mode](./managed-mode.md) synthesized one from `--go-package-prefix`.

## What's in the box

| Path | Contents |
|---|---|
| `cmd/protogenall` | the CLI |
| `internal/compile` | pure-Go proto compilation, managed mode plumbing, descriptor-set output |
| `internal/gen` | the generators — messages, gRPC, gateway |
| `internal/openapival` | OpenAPI enrichment from protovalidate + `field_behavior` |
| `internal/gateway/httprule` | vendored path-template compiler (the one grpc-gateway keeps `internal`) |
| `rest` | runtime helper: ASP.NET Core-style `problem+json` validation errors for the gateway |
| `grpcx` | runtime helper: one-call server reflection + health service |
| `authz` | runtime helper: interceptors enforcing `(protogen.authz.requires)` roles/permissions |

## Where to go next

- [Quick start](./quick-start.md) — from a `.proto` to a running, validated REST+gRPC service.
- [Scaffolding](./scaffolding.md) — `protogenall init` and the zero-flag workflow.
- [Generators](./generators.md) — what each output file contains and how to select them.
- [Streaming](./streaming.md) — the four RPC kinds and gateway server-streaming.
- [Validation and OpenAPI](./validation.md) — protovalidate constraints reflected into the schema, and `problem+json` errors.
- [OpenAPI annotations](./openapi-annotations.md) — document/operation/schema metadata from `openapi.v3.*` options.
- [Roles and permissions](./authz.md) — `protogen.authz` annotations and the enforcement interceptors.
- [Managed mode and monorepos](./managed-mode.md) — `go_package` synthesis and batch generation.
- [Configuration](./configuration.md) — `protogenall.yaml` and every CLI flag.
- [How it works](./how-it-works.md) — the no-`protoc` pipeline and the one tricky bit.
- [CLI reference](./cli.md) — flags, bundled imports, exit behavior.

Source: [github.com/dvislobokov/protogen](https://github.com/dvislobokov/protogen)
