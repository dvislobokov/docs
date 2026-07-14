# Vault Secrets

sconf resolves configuration values from HashiCorp Vault out of the box (since v1.1.0 the integration is built into the core — no extra imports, no registration). Your config file holds only the *path* to a secret; the value is fetched at load time and refreshed in the background automatically. `sconf/secret` defines the field types (standard library only); the Vault client itself lives in the internal `sconf/internal/vault` package.

## How it works

1. Declare fields of type `secret.UserPass`, `secret.Cert`, `secret.KV`, or `secret.Value` in your struct.
2. In the config file, set each field to a Vault path (optionally with query-string parameters).
3. Call the ordinary `sconf.Load` — after binding it walks the struct, finds every field implementing `secret.Resolvable`, fills it from Vault, and starts background refresh for refreshable secrets.

If the struct has **no** secret fields, Vault is never contacted and no environment is required. If secret fields exist but the Vault environment is not configured, `Load` fails with an error wrapping `sconf.ErrVaultNotConfigured`.

## Secret field types

| Type | Vault operation | Read the value via | Typical engines |
|---|---|---|---|
| `secret.UserPass` | read (`GET`) | `Username()`, `Password()` | `database` dynamic/static creds, `openldap`, `ad`, KV with `username`/`password` fields |
| `secret.Value` | read (`GET`) | `Get()` | KV v1/v2, single field |
| `secret.KV` | read (`GET`) | `Get(key)`, `Values()` | KV v1/v2, all fields at once |
| `secret.Cert` | write (`PUT`) | `Certificate()`, `PrivateKey()`, `IssuingCA()`, `CAChain()`, `SerialNumber()` | `pki` issue |

All four also provide `Resolved() bool` (was the secret fetched?) and `Path() string`, and all support background refresh. Accessors are safe for concurrent use — a background refresher may swap the value at any time, so always read through the methods rather than caching the strings at startup.

### Path syntax

A secret reference is a full path from the mount root, optionally followed by query-string parameters:

```txt
database/creds/billing
secret/data/billing?field=stripe_key
pki/issue/internal?common_name=billing.internal&ttl=24h&refresh=12h
```

Reserved parameters are consumed by the resolver: `refresh` (explicit refresh interval), `field` (for `secret.Value`), `username_field` and `password_field` (for `secret.UserPass`). For `secret.Cert`, **all other parameters** are sent to Vault as the issue-request body (`common_name`, `alt_names`, `ip_sans`, `ttl`, `format`, ...).

Type-specific behavior, verified in tests and the example below:

- `secret.UserPass` reads `username` (or `?username_field=`) and picks the password from `current_password` when present (Active Directory returns it), otherwise `password` — so `database`, `openldap`, and `ad` all work without configuration. `?password_field=` overrides the heuristic.
- `secret.KV` and `secret.Value` automatically unwrap the KV v2 envelope (`data`/`metadata`), so for KV v2 you write the path with the `data` segment (`secret/data/billing`) and still address the inner fields directly.
- `secret.Value` without `?field=` works when the secret has exactly one field; otherwise it fails listing the available fields.

## A complete, runnable example

A billing service, verified offline via the local-development mode (below):

```go
type Config struct {
	Service string `yaml:"service"`

	// Secret fields: the YAML holds only Vault paths; Load fills the values.
	DB        secret.UserPass `yaml:"db"`
	StripeKey secret.Value    `yaml:"stripe_key"`
	Extra     secret.KV       `yaml:"extra"`
	TLS       secret.Cert     `yaml:"tls"`

	// Ordinary field populated by the Vault KV *layer* below.
	Webhook struct {
		Secret string `yaml:"webhook_secret"`
	} `yaml:"webhook"`
}

func main() {
	cfg, err := sconf.Load[Config](
		sconf.New().
			AddYAMLFile("appsettings.yaml").
			AddVaultKVAt("secret/data/billing", "webhook"),
		os.Args[1:],
		sconf.WithSecretErrorHandler(func(err error) {
			log.Println("vault refresh:", err)
		}),
	)
	if err != nil {
		log.Fatal(err)
	}
	// Secrets are filled and kept fresh in the background automatically.
	// ...
}
```

```yaml
# appsettings.yaml
service: billing
db: database/creds/billing
stripe_key: secret/data/billing?field=stripe_key
extra: secret/data/billing
tls: pki/issue/internal?common_name=billing.internal&ttl=24h&refresh=12h
```

```sh
VAULT_SECRETS_FILE=dev-secrets.yaml go run .
```

```txt
service=billing
db: user=v-billing-dev pass_len=17 (path database/creds/billing)
stripe key: sk_test_51...
extra: region=eu-central-1 (fields: 3)
tls: serial=0a:1b:2c resolved=true
webhook secret (via KV layer): whsec_local
secrets refreshing in background automatically
```

## Background refresh

`sconf.Load` starts one goroutine per refreshable secret right after resolving them — the refresher runs entirely inside the library and nothing is returned to manage. Its lifetime is tied to the context:

- `sconf.Load` uses `context.Background()` — secrets are refreshed for the lifetime of the process.
- `sconf.LoadContext(ctx, ...)` — cancelling `ctx` stops the refresh goroutines (it also bounds the initial Vault requests).

```go
cfg, err := sconf.LoadContext[Config](ctx, builder, args,
	sconf.WithSecretErrorHandler(func(err error) { log.Println("refresh:", err) }),
	sconf.WithSecretRetryBackoff(15*time.Second),
)
// cancel ctx on shutdown — the background refresh stops with it
```

Options:

| Option | Effect |
|---|---|
| `sconf.WithSecretErrorHandler(fn)` | Called with each background-refresh error. Default: errors are silently ignored and the previous secret value stays in place until the next attempt. |
| `sconf.WithSecretRetryBackoff(d)` | Pause before retrying after a failed refresh. Default: 30 s. |

### Refresh cadence

The interval for each secret is computed from, in priority order:

1. An explicit `?refresh=` parameter on the path — always wins.
2. For `secret.Cert`: about 70% of the certificate's lease/TTL, so it is reissued before expiry.
3. For everything else: every 30 minutes, or ~70% of the lease if that is shorter (so short-lived dynamic credentials never expire before renewal).

Intervals are clamped to a minimum of 10 seconds. When there is no lease at all (for example the local file store), the 30-minute default applies. A refresh failure keeps the old value; the watcher retries after the backoff.

## Environment configuration

The connection is configured entirely through environment variables:

| Variable | Meaning | Default |
|---|---|---|
| `VAULT_ADDR` / `VAULT_URL` | Server address (**required**) | — |
| `VAULT_NAMESPACE` | Namespace (Vault Enterprise / HCP) | — |
| `VAULT_MOUNTPATH` | Optional path prefix applied to every secret path | — |
| `VAULT_TIMEOUT` | Request timeout (Go duration) | `30s` |
| `VAULT_SKIP_VERIFY` | Disable TLS certificate verification (`1`, `true`, `yes`, `on`) | off |
| `VAULT_AUTH` | `token` \| `kubernetes` \| `approle` | `token` |
| `VAULT_TOKEN` | Token (required for `token` auth) | — |
| `VAULT_K8S_ROLE` | Role (required for `kubernetes` auth) | — |
| `VAULT_K8S_MOUNT` | Kubernetes auth mount | `kubernetes` |
| `VAULT_K8S_TOKEN_PATH` | Service-account token path | `/var/run/secrets/kubernetes.io/serviceaccount/token` |
| `VAULT_ROLE_ID` / `VAULT_SECRET_ID` | AppRole credentials (required for `approle` auth) | — |
| `VAULT_APPROLE_MOUNT` | AppRole auth mount | `approle` |
| `VAULT_SECRETS_FILE` | Local secrets file — enables offline development mode | — |
| `VAULT_WAIT` | Wait budget for Vault to become reachable at startup (Go duration) | off |
| `VAULT_WAIT_INTERVAL` | Pause between attempts while waiting | `2s` |

Missing required variables produce an error wrapping `sconf.ErrVaultNotConfigured` that names the exact variable to set. Invalid wait values are errors too: `vault: invalid VAULT_WAIT "..." : ...`.

## Waiting for Vault at startup

By default the initial secret resolution fails fast: the first error aborts `Load`. In environments where Vault is briefly unreachable when the process starts — most commonly behind an istio/envoy sidecar that hasn't opened egress yet, or a Vault node that is still sealed/standby — give `Load` a wait budget:

```go
cfg, err := sconf.Load[Config](builder, os.Args[1:],
	sconf.WithVaultWait(30*time.Second),        // total wait budget
	sconf.WithVaultWaitInterval(2*time.Second), // pause between attempts (default 2s)
)
```

or purely through the environment (no code change): `VAULT_WAIT=30s`, `VAULT_WAIT_INTERVAL=2s`. The environment variables override the options when both are set.

Only *transient* errors are retried: network errors (connection refused, DNS, timeouts) and HTTP `429`/`502`/`503`/`504`. Non-transient failures — `403`/`404`, bad credentials, `ErrVaultNotConfigured`, a cancelled context — return immediately. When the budget runs out, the error is `vault: still unavailable after waiting <timeout>: <last error>`.

::: info
For the [`AddVaultKV`/`AddVaultKVAt` layers](#the-vault-kv-configuration-layer) waiting is enabled **only** via the environment variables — the `WithVaultWait*` options apply to secret-field resolution and do not reach the KV layer.
:::

In Kubernetes with istio, `VAULT_WAIT=30s` complements `holdApplicationUntilProxyStarts: true` — the app starts once the sidecar is ready, and the wait rides out the remaining seconds before egress works.

## Local development: `VAULT_SECRETS_FILE`

Set `VAULT_SECRETS_FILE` to a YAML (or JSON) file and secrets are served from it instead of Vault — no server, no `VAULT_ADDR`, no authentication. The file maps **the same full paths your config uses** to the fields Vault would return:

```yaml
# dev-secrets.yaml — local stand-in for Vault. Do not commit real secrets.
database/creds/billing:
  username: v-billing-dev
  password: dev-only-password

secret/data/billing:
  stripe_key: sk_test_51LocalDev
  webhook_secret: whsec_local
  region: eu-central-1

pki/issue/internal:
  certificate: |
    -----BEGIN CERTIFICATE-----
    (dev certificate)
    -----END CERTIFICATE-----
  private_key: |
    -----BEGIN PRIVATE KEY-----
    (dev key)
    -----END PRIVATE KEY-----
  serial_number: "0a:1b:2c"
```

::: warning
`VAULT_MOUNTPATH` is **not** applied in file mode — the file keys must match the paths written in the application config verbatim. There are no leases in file mode, so refresh intervals fall back to the defaults (or `?refresh=`). Add the file to `.gitignore`.
:::

## The Vault KV configuration layer

Secret *fields* fill a single struct field. When you instead want the contents of a KV secret to become ordinary configuration keys — bindable into plain `string`/`int` fields, overridable by other layers — add a Vault KV **layer** with `AddVaultKV` / `AddVaultKVAt`:

```go
cfg, err := sconf.Load[Config](
	sconf.New().
		AddYAMLFile("appsettings.yaml").
		AddVaultKV("secret/data/myapp").                // into the root
		AddVaultKVAt("secret/data/db", "database"),     // into the "database" section
	os.Args[1:],
)
```

- The path is the full KV path (include the `data` segment for KV v2); the v2 envelope is unwrapped automatically.
- `AddVaultKVAt(path, section)` places the secret's fields under a section; `AddVaultKV(path)` lands them at the root.
- Nested objects and lists inside the secret flatten like any other source (`key:subkey`, `list:0`).
- Connection settings come from the same environment variables as secret fields, and `VAULT_SECRETS_FILE` works here too (that is how the example above fills `webhook:webhook_secret`).

## Failure behavior

- **Secret fields present, Vault unreachable or misconfigured** — `Load` returns an error; the application does not start with empty secrets. Check `errors.Is(err, sconf.ErrVaultNotConfigured)` for the misconfiguration case. With a [wait budget](#waiting-for-vault-at-startup) set, transient errors are retried until the budget is spent before `Load` fails.
- **No secret fields** — the resolver returns immediately; Vault is never dialed.
- **Background refresh failure** — the previous value is kept, the error goes to `WithSecretErrorHandler` (if set), and the refresher retries after the backoff.
- **`Resolved()` returns `false`** after a successful `Load` only if the field's path was never set in the configuration.
