# Commands

## Verbs and groups

`Cmd` creates a leaf command from a handler; the options type is inferred from the handler's signature. `Group` nests commands arbitrarily deep:

```go
scmd.New("depl", "Deploy utility",
	scmd.Cmd("serve", "Run the server", runServe),
	scmd.Group("secrets", "Manage secrets",
		scmd.Cmd("list", "List secrets", runSecretsList),
		scmd.Cmd("set", "Store a secret", runSecretsSet),
	),
)
```

Groups have no flags of their own — shared flags are embedded structs on the leaf options (see [Quick Start](./quick-start.md#1-declare-options-as-structs)). This is deliberate: cobra's persistent-flag and `PersistentPreRun` inheritance is one of its main sources of confusion, and scmd does not reproduce it.

## Root commands (single-command CLIs)

A tool like `gofmt` has no verbs. `Root` makes the app's root executable — it can still have subcommands alongside:

```go
app := scmd.New("protogenall", "protobuf codegen without protoc",
	scmd.Root(scmd.Cmd("", "", runGenerate)),   // `protogenall [flags] [inputs...]`
	scmd.Cmd("init", "Scaffold a project", runInit),
)
```

This is exactly how [protogen](/protogen/)'s CLI is structured.

## Tuning commands with `.With(...)`

`With` applies chainable options to a command:

```go
scmd.Cmd("deploy", "Deploy services", runDeploy).With(
	scmd.Aliases("d"),
	scmd.HelpGroup("Main"),
	scmd.MutuallyExclusive("json", "yaml"),
)
```

| Option | Effect |
|---|---|
| `Aliases("d", ...)` | alternative names; shown in help as `deploy (d)` |
| `HiddenCmd()` | invocable but absent from help, suggestions and completion |
| `DeprecatedCmd("use exec")` | prints a warning to stderr when invoked |
| `HelpGroup("Main")` | groups the command under a titled section in the parent's help |
| `PassUnknownFlags()` | unknown flags become positional args (for wrappers like `app exec -- kubectl ...`) |
| `MutuallyExclusive(flags...)` | usage error if more than one is set explicitly |
| `RequiredTogether(flags...)` | all or none |
| `OneRequired(flags...)` | at least one |

Flag-group constraints are validated fail-fast (a typo in a flag name panics at construction) and rendered in the command's help. A flag counts as "set" when it appears in argv — the `flag.Changed` semantics.

## Interleaved flags

Flags may appear before, between and after command names: `depl -v deploy api --env prod`. One documented restriction: a flag **value** placed before a command name must use the `=` form (`--output=json deploy`), because during routing scmd cannot yet know the flag's arity — a bare value could be mistaken for a command name.

## Errors, suggestions, exit codes

- All parse and binding problems are collected and printed together, followed by `See "depl deploy --help".` (suppress with `WithoutUsageHints()`).
- An unknown command gets a Levenshtein-based `Did you mean "serve"?` suggestion.
- Handlers may return `*scmd.UsageError` to produce exit code 2 with the hint; any other error prints `error: ...` and exits 1.
- `WithVersion("1.2.3")` enables `app --version` / `-V`.
