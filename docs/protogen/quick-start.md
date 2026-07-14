# Quick start

This walks from a single `.proto` file to generated code you can compile, a REST gateway, and an OpenAPI document — then wires the generated server up with runtime validation and role-based authorization.

## 1. Install

```sh
go install github.com/dvislobokov/protogen/cmd/protogenall@latest
```

::: tip The fastest path
`protogenall init myapi && protogenall myapi` scaffolds a project (starter proto + config) and generates it — see [Scaffolding](./scaffolding.md). The rest of this page builds the same thing by hand so you see every moving part.
:::

## 2. Write a proto with validation and a REST mapping

`proto/checkout.proto`:

```proto
syntax = "proto3";
package shop.v1;

import "google/api/annotations.proto";
import "buf/validate/validate.proto";
import "protogen/authz/authz.proto";

service Checkout {
  rpc PlaceOrder(PlaceOrderRequest) returns (PlaceOrderResponse) {
    option (google.api.http) = { post: "/v1/orders" body: "*" };
    // Only authenticated customers may order; enforced in step 6.
    option (protogen.authz.requires) = {
      roles: { any_of: ["customer", "admin"] }
    };
  }
}

enum Currency {
  CURRENCY_UNSPECIFIED = 0;
  USD = 1;
  EUR = 2;
}

message PlaceOrderRequest {
  string customer_email = 1 [(buf.validate.field).required = true, (buf.validate.field).string.email = true];
  Currency currency      = 2 [(buf.validate.field).enum = {defined_only: true, not_in: [0]}];
  int32 quantity         = 3 [(buf.validate.field).int32 = {gte: 1, lte: 100}];
}

message PlaceOrderResponse {
  string order_id = 1;
}
```

All three imports are **bundled in the binary** — you don't add them to `--proto_path` (`protogenall --list-builtins` shows the full list).

## 3. Generate

```sh
protogenall \
  --proto_path=proto \
  --go-package-prefix=example.com/gen \
  --openapi-title="Checkout API" --openapi-version=1.0.0 \
  --out=gen \
  proto
```

Passing the directory `proto` (instead of a file) generates every `.proto` under it. You get:

```txt
gen/checkout.pb.go        # messages
gen/checkout_grpc.pb.go   # gRPC client + server
gen/checkout.pb.gw.go     # REST gateway
gen/openapi.yaml          # OpenAPI v3
```

The OpenAPI schema already reflects your constraints:

```yaml
customerEmail: { type: string, format: email }
currency:      { type: string, enum: [USD, EUR] }   # names, minus the not_in value
quantity:      { type: integer, format: int32, minimum: 1, maximum: 100 }
required: [customerEmail, currency]
```

## 4. Implement the service

```go
package main

import (
	"context"

	shop "example.com/gen"
)

type checkout struct {
	shop.UnimplementedCheckoutServer
}

func (checkout) PlaceOrder(ctx context.Context, in *shop.PlaceOrderRequest) (*shop.PlaceOrderResponse, error) {
	return &shop.PlaceOrderResponse{OrderId: "ord_1"}, nil
}
```

## 5. Validate every request automatically

protovalidate reads the constraints straight from the generated messages — no validator is generated. Add the interceptor from the `rest` helper so invalid requests are rejected with an ASP.NET Core-style `problem+json` body:

```go
import (
	"github.com/dvislobokov/protogen/rest"
	"github.com/dvislobokov/protogen/grpcx"
	"buf.build/go/protovalidate"
	"google.golang.org/grpc"
)

v, _ := protovalidate.New()
s := grpc.NewServer(grpc.UnaryInterceptor(rest.ValidationInterceptor(v)))
shop.RegisterCheckoutServer(s, checkout{})
grpcx.Register(s) // server reflection + health service
```

## 6. Enforce the roles from the proto

The `(protogen.authz.requires)` annotation from step 2 is enforced by one more interceptor. You supply a `SubjectFunc` that pulls the caller's roles from the context (here: trivially from metadata; in production from a JWT — see [Roles and permissions](./authz.md)):

```go
import (
	"context"

	"github.com/dvislobokov/protogen/authz"
	"google.golang.org/grpc/metadata"
)

subject := func(ctx context.Context) (*authz.Subject, error) {
	md, _ := metadata.FromIncomingContext(ctx)
	if roles := md.Get("x-roles"); len(roles) > 0 {
		return &authz.Subject{Roles: roles}, nil
	}
	return nil, nil // anonymous
}

s := grpc.NewServer(grpc.ChainUnaryInterceptor(
	authz.UnaryServerInterceptor(subject), // 401/403 first
	rest.ValidationInterceptor(v),         // then 400 problem+json
))
```

Anonymous calls to `PlaceOrder` now fail with `Unauthenticated` (HTTP **401** through the gateway); a caller without the `customer`/`admin` role gets `PermissionDenied` (**403**).

A bad request through the gateway now comes back as:

```json
HTTP 400  application/problem+json
{
  "title": "One or more validation errors occurred.",
  "status": 400,
  "errors": {
    "customerEmail": ["must be a valid email address"],
    "quantity":      ["must be greater than or equal to 1 and less than or equal to 100"]
  }
}
```

## 7. Serve REST

The generated gateway maps HTTP to gRPC. Register it on a `runtime.ServeMux` (optionally with the `problem+json` error handler):

```go
import (
	"github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
	"github.com/dvislobokov/protogen/rest"
)

mux := runtime.NewServeMux(runtime.WithErrorHandler(rest.ProblemErrorHandler))
_ = shop.RegisterCheckoutHandlerServer(context.Background(), mux, checkout{})
// http.ListenAndServe(":8080", mux)
```

`POST /v1/orders` with a JSON body now flows through the gateway to your gRPC handler.

## Where to go next

- [Scaffolding](./scaffolding.md) — get all of the above from `protogenall init`.
- [Roles and permissions](./authz.md) — JWT/mTLS subjects, rule semantics, testing policies.
- [OpenAPI annotations](./openapi-annotations.md) — summaries, tags and examples from the proto.
- [Generators](./generators.md) — pick a subset with `--generators`.
- [Configuration](./configuration.md) — move all of this into a committed `protogenall.yaml`.
- [Validation and OpenAPI](./validation.md) — the full constraint → schema mapping.
