# Message Templates

A message template is a string with *holes* — `{PropertyName}` placeholders that bind positional arguments to typed structured fields while also rendering a human-readable message. This page documents the complete syntax as implemented by srog's parser.

## Hole grammar

The content between `{` and `}` follows this grammar:

```txt
{ [@|$] (name | index) [ ,alignment ] [ :format ] }
```

| Part | Rule |
| --- | --- |
| `@` or `$` | Optional capturing operator: `@` destructures the value as a structured object, `$` forces its string representation |
| `name` | A letter or `_`, followed by letters, digits, or `_` (e.g. `{OrderId}`, `{retry_count}`) |
| `index` | All digits — a positional hole (`{0}`, `{1}`) that binds `args[index]` |
| `,alignment` | Optional signed integer: positive pads left (right-aligns), negative pads right (left-aligns) |
| `:format` | Optional format specifier applied when rendering the message (everything after the first `:`) |

Malformed holes (empty `{}`, invalid names, unterminated `{`) are tolerated: they are emitted as literal text rather than failing, matching Serilog's resilience. <code v-pre>{{</code> and <code v-pre>}}</code> escape literal braces.

## Named holes

Holes bind arguments **in order of appearance**; each named hole becomes a structured field under its name.

```go
log.Information("pallet {SKU} scanned at dock {Dock}", "SKU-4471", "D3")
```

::: code-group

```txt [Rendered]
INF pallet SKU-4471 scanned at dock D3
```

```json [JSON]
{"level":"info","@mt":"pallet {SKU} scanned at dock {Dock}","SKU":"SKU-4471","Dock":"D3","message":"pallet SKU-4471 scanned at dock D3"}
```

:::

## Positional holes

`{0}`, `{1}`, ... index directly into the argument list. The field key is the index as a string.

```go
log.Information("moved {0} units from {1} to {2}", 96, "A-14-2", "STAGE-1")
```

```json
{"level":"info","@mt":"moved {0} units from {1} to {2}","0":96,"1":"A-14-2","2":"STAGE-1","message":"moved 96 units from A-14-2 to STAGE-1"}
```

## Destructuring with `@`

`{@Name}` serializes the value as a structured JSON object instead of a scalar. The rendered message mirrors the structure Serilog-style: `TypeName { Field: value, ... }`.

```go
type Pallet struct {
	SKU      string
	Units    int
	Location string
}

log.Information("received pallet {@Pallet}", Pallet{SKU: "SKU-4471", Units: 96, Location: "A-14-2"})
```

::: code-group

```txt [Rendered]
INF received pallet Pallet { SKU: "SKU-4471", Units: 96, Location: "A-14-2" }
```

```json [JSON]
{"level":"info","@mt":"received pallet {@Pallet}","Pallet":{"SKU":"SKU-4471","Units":96,"Location":"A-14-2"},"message":"received pallet Pallet { SKU: \"SKU-4471\", Units: 96, Location: \"A-14-2\" }"}
```

:::

Destructured rendering handles structs, maps, slices/arrays, and pointers, quotes strings, and short-circuits `time.Time`, `time.Duration`, and `error` to their scalar forms. Recursion depth is bounded (6 levels) so cyclic or very deep objects render as `...` rather than overflowing.

## Stringify with `$`

`{$Name}` forces the value to its string representation (via `String()`, `Error()`, or `fmt.Sprint`) in **both** the message and the JSON field:

```go
log.Information("raw scanner payload {$Payload}", Pallet{SKU: "SKU-4471", Units: 96, Location: "A-14-2"})
```

```json
{"level":"info","@mt":"raw scanner payload {$Payload}","Payload":"{SKU-4471 96 A-14-2}","message":"raw scanner payload {SKU-4471 96 A-14-2}"}
```

## Format specifiers

The `:format` suffix shapes how a value renders in the message. The JSON field keeps the raw typed value.

- For `time.Time` values, the format is a time layout. A few .NET-style Serilog formats are translated to Go layouts (`HH:mm:ss`, `HH:mm:ss.fff`, `yyyy-MM-dd`, `yyyy-MM-dd HH:mm:ss`, `o`/`O` → RFC 3339 Nano); anything else is passed through as a Go layout.
- For every other type, the format is a Go `fmt` verb **without the leading `%`** — srog renders with `fmt.Sprintf("%"+format, value)`. So `:.1f`, `:x`, `:06d`, `:q` all work.

```go
log.Information("belt utilisation {Utilisation:.1f} percent", 87.3456)
log.Information("cycle finished at {FinishedAt:HH:mm:ss}", time.Date(2026, 7, 13, 14, 32, 9, 0, time.UTC))
log.Information("checksum {Checksum:x}", 48879)
```

```json
{"level":"info","@mt":"belt utilisation {Utilisation:.1f} percent","Utilisation":87.3456,"message":"belt utilisation 87.3 percent"}
{"level":"info","@mt":"cycle finished at {FinishedAt:HH:mm:ss}","FinishedAt":"2026-07-13T14:32:09Z","message":"cycle finished at 14:32:09"}
{"level":"info","@mt":"checksum {Checksum:x}","Checksum":48879,"message":"checksum beef"}
```

## Alignment

`{Name,N}` pads the rendered value to at least `N` characters: positive right-aligns, negative left-aligns.

```go
log.Information("bin {Bin,-8}| qty {Qty,5}", "A-2", 7)
```

```txt
INF bin A-2     | qty     7
```

## Escaped braces

Double the brace to emit a literal one:

```go
log.Information("payload schema is {{sku, units}} for lane {Lane}", 12)
```

```txt
INF payload schema is {sku, units} for lane 12
```

## Missing and surplus arguments

Neither is an error:

- A hole with **no matching argument** is echoed verbatim in the message (and no field is emitted), like Serilog.
- **Surplus arguments** beyond the holes are attached as `extra_N` fields so no data is silently dropped.

```go
log.Information("operator {Operator} badge {Badge}", "svetlana")      // missing Badge
log.Information("conveyor {Line} restarted", "L2", "maintenance", 42) // two extras
```

```json
{"level":"info","@mt":"operator {Operator} badge {Badge}","Operator":"svetlana","message":"operator svetlana badge {Badge}"}
{"level":"info","@mt":"conveyor {Line} restarted","Line":"L2","extra_1":"maintenance","extra_2":42,"message":"conveyor L2 restarted"}
```

## Type binding

Argument values are bound with typed zerolog field methods via a type switch (no reflection on the hot path): `string`, `[]byte`, `bool`, all int/uint widths, `float32/64`, `time.Time`, `time.Duration`, `error`, and `fmt.Stringer` each get their most specific representation. Anything else falls back to `Interface` (JSON serialization), and `nil` is emitted as JSON `null`.

## Template caching

Parsed templates are memoized in a `sync.Map` keyed by the raw template string. Templates are typically string literals, so the cache hit rate approaches 100% and a cached lookup costs about 11 ns with zero allocations (see [Performance](./performance.md)).

::: warning
Because the cache is keyed by the template string and never evicted, avoid interpolating dynamic data into the template itself (e.g. `fmt.Sprintf` into the template). Put dynamic data in the holes — that is what they are for, and it keeps `@mt` stable for grouping.
:::

## Syntax reference

| Syntax | Example | Effect |
| --- | --- | --- |
| `{Name}` | `{OrderId}` | Named hole; typed field `OrderId`, value rendered in message |
| `{0}` | `{0}` | Positional hole; binds `args[0]`, field key `"0"` |
| `{@Name}` | `{@User}` | Destructure: JSON object field + Serilog-style structured rendering |
| `{$Name}` | `{$Req}` | Stringify: string field + string rendering |
| `{Name,N}` | `{Qty,5}` | Right-align rendered value to width 5 |
| `{Name,-N}` | `{Bin,-8}` | Left-align rendered value to width 8 |
| `{Name:fmt}` | `{Rate:.1f}` | Format with Go verb `%.1f` in the message |
| `{Time:layout}` | `{At:HH:mm:ss}` | Time layout (.NET-style shortcuts or Go layout) |
| <code v-pre>{{</code> <code v-pre>}}</code> | <code v-pre>{{sku}}</code> | Literal braces |
