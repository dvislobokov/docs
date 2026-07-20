# Completion, Docs, Localization

## Shell completion

Every app gets a `completion` command automatically (plus a hidden `__complete` command implementing the protocol the scripts call):

```sh
source <(depl completion bash)
depl completion zsh > "${fpath[1]}/_depl"
depl completion fish > ~/.config/fish/completions/depl.fish
depl completion powershell | Out-String | Invoke-Expression
```

Completion covers subcommands (with descriptions, minus hidden ones), flag names, and `enum` values — both for flags (`depl deploy --env <TAB>` → `dev stage prod`) and for positional arguments. If you define your own `completion` command, the automatic one steps aside.

## Generated documentation

The same structural model that renders `--help` generates documentation:

```go
app.GenMarkdownTree("docs/cli")   // one .md per visible command, cross-linked
app.GenManTree("man")             // man section 1, one page per command
```

Hidden commands and flags are excluded; aliases, defaults, env vars, enums, deprecation notes and flag-group constraints are included.

## Localization

All user-facing strings — help section titles, flag annotations like `(default 8080)`, usage errors, deprecation warnings, "did you mean" — live in a `Locale` catalog:

```go
scmd.New("protogenall", "...",
	scmd.WithLocale(scmd.LocaleEN),   // default is LocaleRU
	...)
```

`LocaleRU` and `LocaleEN` ship with the library; `Locale` is a plain struct of strings, so a custom translation is just a value:

```go
de := scmd.LocaleEN
de.Usage = "Verwendung:"
// ...
app := scmd.New("tool", "...", scmd.WithLocale(de))
```

Two things are deliberately *not* localized: fail-fast panic messages (they address the CLI's developer, not its user) and the generated completion scripts' comments (they are code).
