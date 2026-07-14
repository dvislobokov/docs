# Configuration

protogen can be driven entirely by flags, or by a committed `protogenall.yaml`. Explicitly-passed flags always override the config file.

## Config file

Create `protogenall.yaml` (auto-detected in the working directory, or pass `--config path`):

```yaml
proto_paths: [proto]
inputs: [proto]                 # files, directories, or globs
out: gen
go_package_prefix: example.com/gen
proto_package: ""               # override an empty proto package (optional)
descriptor_set_out: ""          # also write a FileDescriptorSet here (optional)
openapi:
  title: Checkout API
  version: 1.0.0
  enum_format: string           # string (default) | number
generators:                     # subset allowed; omit for all
  - messages
  - grpc
  - gateway
  - openapiv3
```

Run it:

```sh
protogenall --config protogenall.yaml
# or, if it sits in the CWD:
protogenall
# or point at the project directory that holds it:
protogenall path/to/project
```

Unknown keys are rejected, so typos fail fast rather than being silently ignored.

::: tip
`protogenall init` scaffolds this file (plus a starter proto) for you — see [Scaffolding](./scaffolding.md).
:::

## Precedence

For every option the order is **explicit flag › config file › built-in default**. For example, with the config above:

```sh
# overrides only the output dir and generator set; everything else comes from the file
protogenall --config protogenall.yaml --out=/tmp/gen --generators=messages,grpc
```

## Flags

| Flag | Default | Purpose |
|---|---|---|
| `--proto_path` | `.` | import root (repeatable), like `protoc -I` |
| `--out` | `gen` | output directory |
| `--go-package-prefix` | — | module prefix for managed-mode `go_package` |
| `--proto-package` | — | override an empty proto `package` |
| `--generators` | all | subset of `messages,grpc,gateway,openapiv3` |
| `--openapi-title` | `API` | OpenAPI document title |
| `--openapi-version` | `0.0.1` | OpenAPI document version |
| `--openapi-enum-format` | `string` | `string` (value names) or `number` |
| `--descriptor-set-out` | — | also write a `FileDescriptorSet` here |
| `--config` | — | path to a `protogenall.yaml` |
| `--list-builtins` | — | print bundled proto imports and exit |
| `--version` | — | print version and exit |

Positional arguments are the inputs (files, directories, globs). They may also be given via `inputs:` in the config.
