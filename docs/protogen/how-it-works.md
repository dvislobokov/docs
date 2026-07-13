# How it works

protogen replaces the entire `protoc` pipeline with in-process Go. Nothing is shelled out; no plugin binaries exist.

```
.proto ─▶ protocompile ─▶ managed mode ─▶ CodeGeneratorRequest ─▶ generators (in-process)
         (no protoc)      (go_package)                            ├─ messages   (internal_gengo)
                                                                  ├─ grpc       (own)
                                                                  ├─ gateway    (own + httprule)
                                                                  └─ openapi v3 (gnostic)
                                                                       └─ openapival enrichment
```

## The pieces

| Stage | How |
|---|---|
| Parse `.proto` | [`bufbuild/protocompile`](https://github.com/bufbuild/protocompile), a pure-Go protobuf compiler — the part that removes `protoc`. |
| Well-known types | `protocompile.WithStandardImports` serves `google/protobuf/*` from embedded descriptors. |
| Bundled imports | `google/api/*` and `buf/validate/*` are `go:embed`-ed and served by a composite resolver, so imports resolve without files on disk. |
| Messages | `protoc-gen-go`'s generator lives at `.../protoc-gen-go/internal_gengo`. The path element is `internal_gengo`, not `internal`, so Go's internal-import rule does not block it — protogen imports it directly. |
| gRPC / gateway | hand-written `protogen`-based generators, modeled on the real plugins' output. The gateway vendors grpc-gateway's `httprule` (the one package it keeps `internal`) for path-template compilation. |
| OpenAPI v3 | `google/gnostic`'s generator, then a YAML post-processing pass. |

## The one tricky bit

There is a single subtlety worth knowing. protocompile, when it links custom options such as `google.api.http`, materializes them as `dynamicpb` messages. Downstream generators — gnostic, and anything using `proto.GetExtension` — expect the **concrete** Go extension type and will not read a dynamic value.

Under real `protoc`, this never comes up: the plugin receives the request as serialized bytes and unmarshals it through the global type registry, so any extension it links against decodes into its concrete type. protogen replicates exactly that boundary in `normalizeExtensions` (`internal/compile/compile.go`): each `FileDescriptorProto` is marshaled and re-unmarshaled through the global registry, turning dynamic options into concrete typed extensions. Because the generator binary links `google.golang.org/genproto/.../annotations` (via gnostic) and the buf.validate types (via the enrichment package), `google.api.http`, `field_behavior`, and `buf.validate` all decode correctly.

This is why validation and HTTP annotations "just work" in-process, and it's the only place where the absence of the `protoc` process needs to be compensated for explicitly.
