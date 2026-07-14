# Roles and permissions — `protogen.authz`

protogen ships a bundled annotation family for declaring **who may call each method** right in the proto, and a runtime package that enforces it with gRPC interceptors. The policy lives next to the API definition, is versioned with it, and needs no separate configuration file.

Two pieces:

- **Annotations** — `protogen/authz/authz.proto` (bundled; just import it) defines `(protogen.authz.requires)` for methods and `(protogen.authz.default_requires)` for services.
- **Enforcement** — `github.com/dvislobokov/protogen/authz` provides `UnaryServerInterceptor`, `StreamServerInterceptor` and an exported `Authorize` for custom transports.

## Declaring requirements

```proto
syntax = "proto3";

package shop.v1;

import "google/api/annotations.proto";
import "protogen/authz/authz.proto";

service Orders {
  // Applies to every method that has no (protogen.authz.requires) of its own.
  option (protogen.authz.default_requires) = {
    roles: { any_of: ["customer", "support", "admin"] }
  };

  // Uses the service default above: any authenticated customer/support/admin.
  rpc GetOrder(GetOrderRequest) returns (Order) {
    option (google.api.http) = { get: "/v1/orders/{id}" };
  }

  // Overrides the default: needs a write permission AND one of the roles.
  rpc CancelOrder(CancelOrderRequest) returns (Order) {
    option (google.api.http) = { post: "/v1/orders/{id}:cancel" body: "*" };
    option (protogen.authz.requires) = {
      roles: { any_of: ["support", "admin"] }      // "oneOf" semantics
      permissions: { all_of: ["orders.write"] }    // "all" semantics
    };
  }

  // Explicitly public: no authentication, no checks.
  rpc TrackOrder(TrackOrderRequest) returns (TrackingInfo) {
    option (google.api.http) = { get: "/v1/orders/{id}/tracking" };
    option (protogen.authz.requires) = { public: true };
  }
}
```

### Rule semantics

A `Rule` is checked against the subject's list of roles (or permissions). Every field you set must pass; combining them expresses compound policies:

| Field | Passes when | Typical use |
|---|---|---|
| `any_of` | the subject has **at least one** of the values | alternative roles ("oneOf") |
| `all_of` | the subject has **every** value | required permission sets |
| `none_of` | the subject has **none** of the values | deny-lists (`banned`, `readonly`) |

```proto
option (protogen.authz.requires) = {
  roles: {
    any_of: ["editor", "admin"]
    none_of: ["suspended"]
  }
  permissions: { all_of: ["billing.read", "billing.write"] }
};
```

### Requirement resolution, method by method

| Situation | Result |
|---|---|
| method has `(protogen.authz.requires)` | that requirement is enforced |
| method has none, service has `(protogen.authz.default_requires)` | the service default is enforced |
| neither | the method is **not checked** |
| requirement is `{ public: true }` | allowed; the subject is not even extracted |
| requirement is `{}` (empty) | any **authenticated** subject passes |

## Enforcing with interceptors

You supply one function — a `SubjectFunc` that extracts the caller's roles and permissions from the request context. Everything else (descriptor lookup, rule evaluation, caching, error mapping) is handled by the package:

```go
import (
    "context"

    "github.com/dvislobokov/protogen/authz"
    "google.golang.org/grpc"
)

s := grpc.NewServer(
    grpc.ChainUnaryInterceptor(authz.UnaryServerInterceptor(subject)),
    grpc.ChainStreamInterceptor(authz.StreamServerInterceptor(subject)),
)
```

`SubjectFunc` semantics:

```go
type SubjectFunc func(ctx context.Context) (*authz.Subject, error)
```

- return a `*authz.Subject{Roles, Permissions}` for an authenticated caller;
- return `(nil, nil)` for an anonymous request — protected methods then fail with `Unauthenticated`;
- return an error to reject outright (mapped to `Unauthenticated`, or passed through unchanged if it already carries a gRPC status).

### Example: subject from a JWT

```go
import (
    "context"
    "strings"

    "github.com/dvislobokov/protogen/authz"
    "github.com/golang-jwt/jwt/v5"
    "google.golang.org/grpc/metadata"
)

type claims struct {
    jwt.RegisteredClaims
    Roles  []string `json:"roles"`
    Scopes []string `json:"scopes"`
}

func subjectFromJWT(key []byte) authz.SubjectFunc {
    return func(ctx context.Context) (*authz.Subject, error) {
        md, _ := metadata.FromIncomingContext(ctx)
        auth := md.Get("authorization")
        if len(auth) == 0 {
            return nil, nil // anonymous — public methods still work
        }
        raw := strings.TrimPrefix(auth[0], "Bearer ")
        var c claims
        if _, err := jwt.ParseWithClaims(raw, &c, func(*jwt.Token) (any, error) { return key, nil }); err != nil {
            return nil, err // → Unauthenticated
        }
        return &authz.Subject{Roles: c.Roles, Permissions: c.Scopes}, nil
    }
}
```

```go
subject := subjectFromJWT(signingKey)
s := grpc.NewServer(
    grpc.ChainUnaryInterceptor(authz.UnaryServerInterceptor(subject)),
    grpc.ChainStreamInterceptor(authz.StreamServerInterceptor(subject)),
)
shop.RegisterOrdersServer(s, ordersImpl{})
```

### Example: subject from mTLS peer identity

Any context-derived identity works — here roles come from a certificate's OU:

```go
func subjectFromPeerCert(ctx context.Context) (*authz.Subject, error) {
    p, ok := peer.FromContext(ctx)
    if !ok {
        return nil, nil
    }
    tlsInfo, ok := p.AuthInfo.(credentials.TLSInfo)
    if !ok || len(tlsInfo.State.PeerCertificates) == 0 {
        return nil, nil
    }
    cert := tlsInfo.State.PeerCertificates[0]
    return &authz.Subject{Roles: cert.Subject.OrganizationalUnit}, nil
}
```

### Chaining with validation

Authorize first, validate second — no point validating a request you are about to reject:

```go
v, _ := protovalidate.New()
s := grpc.NewServer(
    grpc.ChainUnaryInterceptor(
        authz.UnaryServerInterceptor(subject),   // 401/403
        rest.ValidationInterceptor(v),           // 400 problem+json
    ),
)
```

## Error mapping and the gateway

Failures come back as standard gRPC codes, which the generated gateway translates to HTTP automatically:

| Condition | gRPC code | HTTP via gateway |
|---|---|---|
| protected method, no subject | `Unauthenticated` | **401** |
| `SubjectFunc` returned an error | `Unauthenticated` (or the error's own status) | 401 (or mapped) |
| roles rule failed | `PermissionDenied` | **403** |
| permissions rule failed | `PermissionDenied` | **403** |

So a REST client calling `POST /v1/orders/ord_1:cancel` without a token gets a `401`, and with a customer token gets a `403` — with no gateway-side configuration.

::: tip Forwarding the Authorization header
The grpc-gateway forwards `Authorization` to gRPC metadata by default, so the JWT `SubjectFunc` above works unchanged for REST traffic.
:::

## Custom transports — `Authorize`

The exact policy evaluation is exported, so any non-interceptor entry point can reuse it:

```go
// e.g. inside a hand-written HTTP handler or a message consumer
err := authz.Authorize(ctx, "/shop.v1.Orders/CancelOrder", subject)
if err != nil {
    // status.Code(err) is Unauthenticated or PermissionDenied
}
```

The full method name is the standard gRPC form: `/<package>.<Service>/<Method>`. Requirements are resolved from the generated descriptors through the global registry and memoized per method, so repeated calls are cheap.

## Testing your policies

The annotations make policies testable without any real auth infrastructure — inject a fake `SubjectFunc` over an in-memory connection:

```go
func newTestClient(t *testing.T, sub *authz.Subject) shop.OrdersClient {
    subject := func(ctx context.Context) (*authz.Subject, error) { return sub, nil }

    lis := bufconn.Listen(1 << 20)
    s := grpc.NewServer(grpc.ChainUnaryInterceptor(authz.UnaryServerInterceptor(subject)))
    shop.RegisterOrdersServer(s, ordersImpl{})
    go s.Serve(lis)
    t.Cleanup(s.Stop)

    conn, err := grpc.NewClient("passthrough:///bufnet",
        grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) { return lis.DialContext(ctx) }),
        grpc.WithTransportCredentials(insecure.NewCredentials()))
    if err != nil {
        t.Fatal(err)
    }
    t.Cleanup(func() { conn.Close() })
    return shop.NewOrdersClient(conn)
}

func TestCancelRequiresSupportRole(t *testing.T) {
    client := newTestClient(t, &authz.Subject{Roles: []string{"customer"}})
    _, err := client.CancelOrder(context.Background(), &shop.CancelOrderRequest{Id: "ord_1"})
    if status.Code(err) != codes.PermissionDenied {
        t.Fatalf("want PermissionDenied, got %v", err)
    }
}
```

## Where to go next

- [Scaffolding](./scaffolding.md) — `protogenall init` writes a starter proto with authz already wired.
- [Validation and OpenAPI](./validation.md) — the `400 problem+json` counterpart for request bodies.
- [Quick start](./quick-start.md) — the full service walkthrough.
