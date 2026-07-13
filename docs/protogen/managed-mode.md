# Managed mode and monorepos

## Managed mode

Managed mode fills in language metadata your `.proto` files omit, so you can keep them free of Go-specific options. It runs after parsing and before generation.

Given a proto with **no** `option go_package`:

```proto
package greeter.v1;   // no go_package
```

pass a module prefix, and protogen synthesizes one:

```sh
protogenall --proto_path=proto --go-package-prefix=example.com/gen --out=gen proto
```

The rule is `<prefix>/<dir>;<name>`, where `<dir>` is the proto's path relative to its import root and `<name>` is derived from the proto package (a trailing version segment like `v1` is skipped in favor of the segment before it — so `greeter.v1` → package `greeter`).

You can also override an empty `package` declaration:

```sh
protogenall --proto-package=greeter.v1 ...
```

This mirrors buf's "managed mode": metadata lives outside the proto, supplied at generation time.

## Batch generation

Inputs may be **files, directories, or globs**. A directory is walked recursively for `*.proto`, and each file is mapped to its import-relative name. Output mirrors the source tree.

```sh
# generate the whole tree in one call
protogenall --proto_path=monorepo --go-package-prefix=example.com/gen --out=gen monorepo

# or a glob
protogenall --proto_path=monorepo --go-package-prefix=example.com/gen --out=gen "monorepo/users/v1/*.proto"
```

For a layout like:

```
monorepo/
  common/money.proto        package common;
  orders/v1/order.proto      package orders.v1;   imports common/money.proto
  users/v1/user.proto        package users.v1;
```

one invocation produces:

```
gen/common/money.pb.go
gen/orders/v1/order.pb.go   (+ _grpc)
gen/users/v1/user.pb.go     (+ _grpc)
gen/openapi.yaml
```

Each directory becomes its own Go package (managed mode derives `go_package` from the path), cross-package imports resolve, and the generated code compiles as a set.

> **Note:** OpenAPI is written as a single `openapi.yaml` per run. For separate specs per application, run protogen once per application directory.
