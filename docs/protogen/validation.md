# Validation and OpenAPI

protogen uses [protovalidate](https://github.com/bufbuild/protovalidate) for validation. There is **no generated validator** — protovalidate reads the constraints from the message descriptors at runtime (via CEL). protogen's job is twofold: bundle the annotation proto so you can write constraints, and **reflect those constraints into the OpenAPI schema** so your contract matches what's enforced.

## Writing constraints

`buf/validate/validate.proto` is bundled in the binary, so just import it:

```proto
import "buf/validate/validate.proto";

message PlaceOrderRequest {
  string customer_email = 1 [(buf.validate.field).required = true, (buf.validate.field).string.email = true];
  string customer_name  = 2 [(buf.validate.field).string = {min_len: 2, max_len: 60}];
  string idempotency_key = 3 [(buf.validate.field).string.uuid = true];
  Currency currency     = 4 [(buf.validate.field).enum = {defined_only: true, not_in: [0]}];
  repeated LineItem items = 5 [(buf.validate.field).repeated = {min_items: 1, max_items: 50}];
  int32 discount_percent = 6 [(buf.validate.field).int32 = {gte: 0, lte: 100}];
  bool accept_terms     = 7 [(buf.validate.field).bool.const = true];
}
```

## Constraint → OpenAPI mapping

The enrichment step (`internal/openapival`) walks the descriptors and adds the corresponding keywords to `openapi.yaml`:

| protovalidate | OpenAPI |
|---|---|
| `required` | added to the schema's `required` list |
| `string.min_len` / `max_len` / `len` | `minLength` / `maxLength` (both, for `len`) |
| `string.pattern` | `pattern` |
| `string.email` / `uuid` / `hostname` / `ipv4` / `uri` | `format` |
| `string.const` / `in` | `enum` |
| numeric `gte` / `lte` | `minimum` / `maximum` |
| numeric `gt` / `lt` | `minimum` / `maximum` + `exclusiveMinimum` / `exclusiveMaximum` |
| numeric `const` | `enum` |
| `bool.const` | `enum` |
| `repeated.min_items` / `max_items` / `unique` | `minItems` / `maxItems` / `uniqueItems` |

Numeric constraints are handled for `int32/int64`, `uint32/uint64`, `float`, and `double`.

## Enums as strings

Enum-typed fields render as `type: string` with the value **names** by default — matching how grpc-gateway's protojson marshaler serializes enums over REST:

```yaml
currency:
  type: string
  enum: [USD, EUR, GBP]   # excludes the not_in / undefined values
```

Switch to numeric with an `x-enum-varnames` hint via `--openapi-enum-format=number` (or `openapi.enum_format: number` in the config):

```yaml
currency:
  type: integer
  enum: [1, 2, 3]
  x-enum-varnames: [USD, EUR, GBP]
```

## Field behavior

`google/api/field_behavior.proto` is bundled too. It maps to OpenAPI access modifiers:

| `field_behavior` | OpenAPI |
|---|---|
| `REQUIRED` | added to `required` |
| `OUTPUT_ONLY` | `readOnly: true` |
| `INPUT_ONLY` | `writeOnly: true` |

```proto
string order_id     = 1 [(google.api.field_behavior) = OUTPUT_ONLY];  // readOnly
string payment_token = 2 [(google.api.field_behavior) = INPUT_ONLY];  // writeOnly
```

## The 400 response, documented

Every operation whose request message carries constraints (directly or transitively) gets a `400` response referencing a generated `ValidationProblemDetails` schema — so the failure contract is in the spec, not just in code:

```yaml
"400":
  description: One or more validation errors occurred.
  content:
    application/problem+json:
      schema:
        $ref: '#/components/schemas/ValidationProblemDetails'
```

## Enforcing it at runtime

The `rest` package turns a protovalidate failure into an ASP.NET Core-style RFC 9457 `problem+json` response, with field keys in JSON (camelCase) so they match the payload and the OpenAPI schema.

```go
import "github.com/dvislobokov/protogen/rest"

v, _ := protovalidate.New()

// 1. validate every unary request on the gRPC side, attaching BadRequest details
s := grpc.NewServer(grpc.UnaryInterceptor(rest.ValidationInterceptor(v)))

// 2. render those details as problem+json on the gateway
mux := runtime.NewServeMux(runtime.WithErrorHandler(rest.ProblemErrorHandler))
```

```json
HTTP 400  application/problem+json
{
  "type": "https://datatracker.ietf.org/doc/html/rfc9110#section-15.5.1",
  "title": "One or more validation errors occurred.",
  "status": 400,
  "errors": {
    "customerEmail": ["must be a valid email address"],
    "items":         ["must contain at least 1 item(s)"],
    "acceptTerms":   ["must equal true"]
  }
}
```

So a constraint in the proto is enforced at runtime, surfaced as `problem+json`, and described in OpenAPI — all from one declaration.
