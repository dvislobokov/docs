# OpenAPI annotations

Beyond what protogen infers automatically (paths from `google.api.http`, schemas from field types and comments, constraints from protovalidate), you can shape the OpenAPI document directly from the proto with the `openapi.v3.*` options. These are [gnostic's annotations](https://github.com/google/gnostic/blob/main/openapiv3/annotations.proto), read natively by protogen's OpenAPI generator, and `openapiv3/annotations.proto` is bundled in the binary — just import it.

## The four annotation levels

| Option | Attaches to | Controls |
|---|---|---|
| `(openapi.v3.document)` | file | `info` (title, version, description), servers, tags, security schemes |
| `(openapi.v3.operation)` | rpc | `summary`, `description`, `tags`, `deprecated`, `security`, responses |
| `(openapi.v3.schema)` | message | schema-level `description`, `title`, and any schema keyword |
| `(openapi.v3.property)` | field | per-property overrides: `description`, `example`, `max_length`, `format`, … |

## Full example

```proto
syntax = "proto3";

package pet.v1;

import "google/api/annotations.proto";
import "openapiv3/annotations.proto";

option (openapi.v3.document) = {
  info: {
    title: "Pet Store API"
    version: "1.2.3"
    description: "Everything about your pets."
  }
};

service PetService {
  rpc GetPet(GetPetRequest) returns (Pet) {
    option (google.api.http) = { get: "/v1/pets/{id}" };
    option (openapi.v3.operation) = {
      summary: "Fetch a pet"
      description: "Returns a single pet by its identifier."
      tags: ["pets", "read"]
      deprecated: true
    };
  }
}

message GetPetRequest {
  string id = 1 [(openapi.v3.property) = {
    description: "Pet identifier"
    example: {yaml: "\"pet-42\""}
  }];
}

message Pet {
  option (openapi.v3.schema) = {
    description: "A pet in the store."
  };
  string id = 1;
  string name = 2 [(openapi.v3.property) = { max_length: 64 }];
}
```

Generated `openapi.yaml` (excerpt):

```yaml
openapi: 3.0.3
info:
    title: Pet Store API
    description: Everything about your pets.
    version: 1.2.3
paths:
    /v1/pets/{id}:
        get:
            tags: [PetService, pets, read]
            summary: Fetch a pet
            description: Returns a single pet by its identifier.
            deprecated: true
            ...
components:
    schemas:
        Pet:
            type: object
            properties:
                id: { type: string }
                name: { maxLength: 64, type: string }
            description: A pet in the store.
```

## Precedence

- `(openapi.v3.document).info` **wins** over `--openapi-title` / `--openapi-version` (and the `openapi:` block in `protogenall.yaml`). Use the flags for defaults and the annotation when the proto should own its metadata.
- Operation `tags` are appended to the automatic service-name tag.
- Leading comments on messages/fields still flow into descriptions when no annotation overrides them; an annotation takes precedence over the comment.
- protovalidate enrichment (`minLength`, `format`, `required`, …) is applied after generation and composes with these annotations — see [Validation and OpenAPI](./validation.md).

## Interaction with protovalidate

You rarely need `(openapi.v3.property)` for constraints — write [`buf.validate`](./validation.md) rules instead and get both runtime validation *and* the schema keywords for free. Reach for the openapi annotations for things validation doesn't express: examples, prose descriptions, deprecation, tags, security.

## Where to go next

- [Validation and OpenAPI](./validation.md) — the constraint → schema mapping.
- [Roles and permissions](./authz.md) — the other bundled annotation family.
