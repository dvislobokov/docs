# Project scaffolding — `protogenall init`

`protogenall init` creates a ready-to-generate project: a starter `.proto` with every annotation family already wired up (`google.api.http`, `buf.validate`, `openapi.v3`, `protogen.authz`) and a committed `protogenall.yaml`. After that, generation is a single argument-less command.

## Two commands, zero flags

```sh
protogenall init myapi
protogenall myapi          # or: cd myapi && protogenall
```

```txt
initializing protogen project in myapi
  wrote: proto/myapi/v1/myapi.proto
  wrote: protogenall.yaml

next steps:
  protogenall myapi        # or: cd myapi && protogenall
  edit proto/myapi/v1/myapi.proto and re-run
```

The second command produces the full output set:

```txt
project directory: myapi
using config: protogenall.yaml
compiling 1 proto file(s) with bufbuild/protocompile (no protoc)...
generating:
  wrote gen/myapi/v1/myapi.pb.go
  wrote gen/myapi/v1/myapi_grpc.pb.go
  wrote gen/myapi/v1/myapi.pb.gw.go
  wrote gen/openapi.yaml
```

## What init derives, and from where

| Item | Source |
|---|---|
| project name (`myapi.v1`, file names) | base of the `module` path in `go.mod` if present, else the directory name (sanitized to a valid proto identifier) |
| `go_package_prefix` | `<module>/gen` from `go.mod`, else `example.com/<name>/gen` |
| directory layout | `proto/<name>/v1/<name>.proto`, output to `gen/` |

Run `init` inside an existing Go module and the generated `go_package` values immediately match your import paths — no editing needed:

```sh
cd $(mktemp -d) && go mod init example.com/petshop
protogenall init          # name: petshop, prefix: example.com/petshop/gen
protogenall               # gen/petshop/v1/*.pb.go import as example.com/petshop/gen/petshop/v1
```

## The scaffolded proto

The template is a small but complete service that demonstrates each annotation in a working configuration:

```proto
syntax = "proto3";

package myapi.v1;

import "google/api/annotations.proto";
import "google/api/field_behavior.proto";
import "buf/validate/validate.proto";
import "openapiv3/annotations.proto";
import "protogen/authz/authz.proto";

option (openapi.v3.document) = {
  info: { title: "Myapi API" version: "0.1.0" }
};

service MyapiService {
  // Methods without their own (protogen.authz.requires) stay public.
  option (protogen.authz.default_requires) = { public: true };

  rpc GetMyapi(GetMyapiRequest) returns (Myapi) {
    option (google.api.http) = { get: "/v1/myapi/{id}" };
    option (openapi.v3.operation) = { summary: "Fetch a myapi by id" };
  }

  rpc CreateMyapi(CreateMyapiRequest) returns (Myapi) {
    option (google.api.http) = { post: "/v1/myapi" body: "*" };
    option (openapi.v3.operation) = { summary: "Create a myapi" };
    option (protogen.authz.requires) = {
      roles: { any_of: ["admin", "editor"] }
    };
  }
}

message GetMyapiRequest {
  string id = 1 [(buf.validate.field).string = {min_len: 1, max_len: 64}];
}

message CreateMyapiRequest {
  string name = 1 [(buf.validate.field).string = {min_len: 1, max_len: 100}];
}

message Myapi {
  string id = 1 [(google.api.field_behavior) = OUTPUT_ONLY];
  string name = 2;
}
```

All five imports are bundled in the binary (`--list-builtins`) — nothing to vendor.

## Behavior details

- **Idempotent.** Re-running `init` never overwrites existing files; it prints `exists, skipped` per file. Pass `--force` to overwrite.
- **`protogenall <dir>`** treats any directory that holds a `protogenall.yaml` as a project root and generates it as if run from inside — handy in monorepos and CI:
  ```sh
  protogenall services/billing   # == cd services/billing && protogenall
  ```
- **`init` with no argument** scaffolds the current directory.

## Where to go next

- [Quick start](./quick-start.md) — implement and serve the generated service.
- [Roles and permissions](./authz.md) — enforce the scaffolded `(protogen.authz.requires)` with interceptors.
- [Configuration](./configuration.md) — everything `protogenall.yaml` accepts.
