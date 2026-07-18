# Error Handling

sconf reports failures through wrapped sentinel errors, so callers branch with `errors.Is` instead of parsing messages. This page lists every sentinel and shows the exact messages, captured from a running program.

## The sentinels

| Sentinel | Package | Returned when |
|---|---|---|
| `sconf.ErrHelp` | `sconf` | Kept for compatibility: since v1.7.0 `Load` prints usage and exits the process itself on a help flag, so this error is no longer observed in normal code. |
| `sconf.ErrBindType` (= `bind.ErrBindType`) | `sconf`, `sconf/bind` | A value cannot be converted to the target field type (wrapped via `%w`). |
| `sconf.ErrEnum` (= `bind.ErrEnum`) | `sconf`, `sconf/bind` | A value is not in the field's `enum` list (wrapped via `%w`). |
| `sconf.ErrVaultNotConfigured` | `sconf` | The struct has secret fields but the Vault environment is incomplete (missing `VAULT_ADDR`, missing auth credentials, or an unknown `VAULT_AUTH`). |

## The standard handling pattern

```go
type Config struct {
	Mode string `enum:"dev,prod" default:"dev"`
	Port int    `default:"8080"`
}

cfg, err := sconf.Load[Config](builder, os.Args[1:])
// (--help never reaches here: Load prints usage and exits the process itself)
switch {
case errors.Is(err, sconf.ErrEnum):
	log.Fatalf("invalid option value: %v", err)
case errors.Is(err, sconf.ErrBindType):
	log.Fatalf("malformed configuration value: %v", err)
case err != nil:
	log.Fatal(err) // I/O, parse, or Vault errors
}
```

## What the errors look like

Captured output from the verification program, one case per line:

```txt
valid      ok
enum       enum violation: config: "Mode" = "staging": config: value not allowed (allowed: dev, prod)
type       type error: config: cannot bind "Port" (value "eighty") to int: config: cannot bind value to type (strconv.ParseInt: parsing "eighty": invalid syntax)
help       help requested
file       config: read "nope.json": open nope.json: The system cannot find the file specified.
```

(The `valid` case set `mode=PROD` — enum matching is case-insensitive, and the bound value is canonicalized to `prod`.)

### Error message anatomy

- **Enum violations** include the key path (in its original spelling), the offending value, and the allowed list: `config: "Mode" = "staging": ... (allowed: dev, prod)`.
- **Type errors** include the key path, the raw value, the target type, and the underlying cause: `config: cannot bind "Port" (value "eighty") to int: ... (strconv.ParseInt: ...)`.
- **File errors** wrap the OS error: `config: read "<path>": ...` for I/O and `config: parse "<path>": ...` for malformed content. A file added with `sconf.Wait(timeout)` that never appears produces `config: file "<path>" did not appear within <timeout>`.
- **Validator failures** are wrapped with the section path: `config: validate "encoder": av1 requires at least 4 threads, got 2` (captured output — see [Advanced](./advanced.md#self-validation-with-validator)).

## Help handling in detail

`Load` checks `args` for `-h`, `--h`, `-help`, `--help`, `-?`, `/?`, `/help`, `/h` *before* building anything. On a match it prints the usage in the requested format (honoring a [`--format` flag](./usage-help.md#help-format); the default table view ends with the built-in flags section) to stdout and **exits the process with code 0** — since v1.7.0 the caller has nothing to do. `sconf.ErrHelp` remains exported for compatibility with older `errors.Is` branches. An unknown `--format` value is the exception: `Load` prints nothing, does not exit, and returns `config: unknown help format "..." (want table|env|json|yaml|toml)`. Pass `nil` args to opt out entirely.

## `sconf.ErrVaultNotConfigured` in detail

Returned only when the configuration actually contains secret fields. The message names the missing variable, for example:

```txt
vault: not configured: set VAULT_ADDR (or VAULT_URL) — config has secret fields but Vault is not configured
```

Other variants: `VAULT_AUTH=token requires VAULT_TOKEN`, `VAULT_AUTH=kubernetes requires VAULT_K8S_ROLE`, `VAULT_AUTH=approle requires VAULT_ROLE_ID and VAULT_SECRET_ID`, and `unknown VAULT_AUTH "..."`. Related startup errors from the [Vault wait](./vault.md#waiting-for-vault-at-startup) feature: `vault: invalid VAULT_WAIT "..."` for a malformed duration and `vault: still unavailable after waiting <timeout>: <last error>` when the wait budget runs out. Handle it when you want a friendlier startup diagnostic:

```go
if errors.Is(err, sconf.ErrVaultNotConfigured) {
	log.Fatal("this service needs Vault; see deployment docs: ", err)
}
```

## Panics (programmer errors)

`bind.Bind` panics when the target is not a non-nil pointer. You will not hit this through `sconf.Load` — it always passes a freshly allocated `*T` — only through direct misuse of the low-level API.
