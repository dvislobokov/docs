# Environments

shost has a lightweight environment concept — the analog of ASP.NET Core's `IHostEnvironment` — for selecting environment-specific behavior and config.

```go
type Environment string

const (
	Development Environment = "Development"
	Staging     Environment = "Staging"
	Production  Environment = "Production"
)
```

## Reading the environment

```go
env := shost.EnvironmentFromEnv("") // reads APP_ENVIRONMENT; unset => Production
```

`EnvironmentFromEnv` takes the variable name to read; passing `""` uses the default `DefaultEnvironmentVar` (`APP_ENVIRONMENT`). An unset or empty value resolves to `Production`.

Pass it to the builder:

```go
host := shost.New().
	WithEnvironment(env).
	MustBuild()

host.Environment().IsProduction() // true
```

## Methods

```go
func (e Environment) Is(other Environment) bool // case-insensitive
func (e Environment) IsDevelopment() bool
func (e Environment) IsStaging() bool
func (e Environment) IsProduction() bool
func (e Environment) String() string
```

`Is` is case-insensitive, so `Environment("production")` matches `Production`. The environment is a plain string, so custom values beyond the three constants are allowed — `Is`/`String` still work.

## Layering config with sconf

The common use is selecting an environment-specific config layer with [sconf](/sconf/):

```go
env := shost.EnvironmentFromEnv("")

cfg, err := sconf.Load[Config](
	sconf.New().
		AddYAMLFile("appsettings.yaml").
		AddYAMLFile("appsettings."+env.String()+".yaml", sconf.Optional()).
		AddEnvironmentVariables("APP_"),
	os.Args[1:],
)
```

`appsettings.Development.yaml` overrides the base only in development; the environment variable layer wins over both. This mirrors the ASP.NET Core `appsettings.{Environment}.json` pattern.
