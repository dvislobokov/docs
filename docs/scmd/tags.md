# Tags Reference

Options structs are declared with tags on exported fields. The entire contract is validated when the app is constructed — a bad tag is a panic with the exact type and field, so a single `newApp()` smoke test covers the whole CLI.

## Flag tags

| Tag | Meaning |
|---|---|
| `flag:"port"` | long flag name (`--port`). Required for a flag field. `help` and `version` are reserved |
| `short:"p"` | one-character short form (`-p`). `h` and `V` are reserved |
| `default:"8080"` | value when nothing else provides one; must parse into the field type (checked fail-fast) |
| `required:"true"` | usage error when absent; incompatible with `default` |
| `enum:"dev,stage,prod"` | allowed values; checked per element for slices; default must be a member; completion suggests them |
| `help:"..."` | description for help, completion and generated docs |
| `env:"APP_PORT"` | environment variable consulted between argv and the sconf layer |
| `conf:"server.port"` | sconf key (dots become `:`); defaults to the flag name — see [Configuration layers](./configuration.md) |
| `hidden:"true"` | omitted from help and completion, still functional |
| `deprecated:"use --new"` | stderr warning when used explicitly |

## Positional-argument tags

| Tag | Meaning |
|---|---|
| `arg:"config"` | positional argument, filled in declaration order; `required:"true"`, `enum` and `help` apply |
| `arg:"..."` | rest: all remaining tokens including everything after `--`; must be `[]string`, must be last |
| `name:"inputs"` | display name of the rest argument in help (`[inputs...]`); defaults to the lowercased field name |

Required positionals must precede optional ones. Negative numbers (`-5`) are recognized as positional values, not flags.

## Supported field types

| Type | Behavior |
|---|---|
| `string`, `bool`, ints, uints, floats | parsed with strconv; bool flags are bare (`--debug`) or explicit (`--debug=false`) |
| `time.Duration` | `30s`, `1h5m`, ... |
| `[]T` | repeatable and/or comma-separated: `-t a -t b,c` → `[a b c]` |
| `map[string]T` | `k=v` pairs, repeatable/comma-separated: `-l team=core,tier=1` (pflag `StringToString` style) |
| `scmd.Count` | occurrence counter: `-vvv` → 3, `--verbose=2` → 2 |
| `scmd.Value[T]` | scalar wrapper tracking origin: `Get()`, `IsSet()`, `Source()` |
| `encoding.TextUnmarshaler` | any custom type that can parse itself |

## Shared flags via embedding

Embed a struct to share flags between commands — visible in the code, no tree-walking semantics:

```go
type Globals struct {
	Verbose scmd.Count `flag:"verbose" short:"v"`
}
type DeployOptions struct {
	Globals                       // deploy has --verbose/-v
	Env string `flag:"env" required:"true"`
}
```

## Custom validation

A `Validate() error` method on the options struct (value or pointer receiver) runs after binding and before the handler; an error becomes a usage error with exit code 2. The interface is compatible with sconf's `Validator`.

## What fail-fast catches

Construction panics — with `Type.Field` in the message — on: empty/duplicate/reserved flag names or shorts, multi-character shorts, `required`+`default` together, a `default` that does not parse or is outside `enum`, `enum` on a map flag, unexported tagged fields, a field tagged both `flag` and `arg`, non-`[]string` rest args, slices for non-rest positionals, `scmd.Value` over slices or maps, required positionals after optional ones, anything after `arg:"..."`, and flag-group constraints naming unknown flags.
