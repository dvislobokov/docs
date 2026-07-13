# Databases

sorm's runtime talks to a small `sorm.DB` interface; concrete databases plug in through two driver adapters and three dialects. The same models and queries run on PostgreSQL, MySQL, and SQLite — engine-specific features fail with explicit build errors rather than rendering wrong SQL.

## Adapters and dialects

| Database | Adapter | Wraps | Dialect | Placeholders | Auto-PK |
|---|---|---|---|---|---|
| PostgreSQL | `driver/pgxd` | `*pgxpool.Pool`, `*pgx.Conn`, `pgx.Tx` | `dialect/pg` | `$1` | `RETURNING` |
| MySQL | `driver/sqld` | `*sql.DB` (`go-sql-driver/mysql`) | `dialect/my` | `?` | `LastInsertId` |
| SQLite | `driver/sqld` | `*sql.DB` (`modernc.org/sqlite`, pure Go) | `dialect/lite` | `?` | `LastInsertId` |

The adapters also differ in batching: `pgxd` sends a write batch in **one roundtrip** via `pgx.Batch`; `sqld` executes batch items sequentially on the current connection. Both translate driver-specific constraint violations into `*sorm.ConstraintError` and classify transient errors (deadlock, serialization failure) for `RunInTx` retries.

## Connecting

::: code-group

```go [postgres]
import (
    "github.com/jackc/pgx/v5/pgxpool"
    "github.com/dvislobokov/sorm/driver/pgxd"
)

pool, err := pgxpool.New(ctx, "postgres://user:pass@localhost:5432/library")
if err != nil { ... }
db := pgxd.Wrap(pool)   // dialect is implied: postgres
```

```go [mysql]
import (
    "database/sql"
    _ "github.com/go-sql-driver/mysql"

    "github.com/dvislobokov/sorm/dialect/my"
    "github.com/dvislobokov/sorm/driver/sqld"
)

sdb, err := sql.Open("mysql", "user:pass@tcp(localhost:3306)/library?parseTime=true")
if err != nil { ... }
db := sqld.Wrap(sdb, my.Dialect{})
```

```go [sqlite]
import (
    "database/sql"
    _ "modernc.org/sqlite"   // pure Go, no cgo

    "github.com/dvislobokov/sorm/dialect/lite"
    "github.com/dvislobokov/sorm/driver/sqld"
)

sdb, err := sql.Open("sqlite", "file:library.db")
if err != nil { ... }
db := sqld.Wrap(sdb, lite.Dialect{})
```

:::

::: tip SQLite specifics
For an in-memory database use `sql.Open("sqlite", ":memory:")` and `sdb.SetMaxOpenConns(1)` — the memory database lives in a single connection. With MySQL, always pass `parseTime=true` so `time.Time` columns scan correctly.
:::

## Feature availability by dialect

| Feature | PostgreSQL | MySQL | SQLite |
|---|---|---|---|
| Core queries, sessions, relations, projections | yes | yes | yes |
| `ForUpdate` / `ForUpdateSkipLocked` | yes | yes (8+) | build error |
| Array columns (`sorm:"array"`) | yes | rejected at DDL | rejected at DDL |
| JSON `Path` / `HasKey` | yes | yes | yes |
| JSON `Contains` | yes (`@>`) | yes (`JSON_CONTAINS`) | build error |
| `ILike` | native | via `LIKE` semantics | case-insensitive `LIKE` |
| Dialect aggregates | `pgagg` | `myagg` | portable core only |
| `Upsert` conflict target | `ON CONFLICT (cols)` | any unique key (`OnConflict` ignored) | `ON CONFLICT (cols)` |
| Migration files in a transaction | yes | no (implicit DDL commit) | yes |

Errors for unsupported features are returned when the query executes, with an explanation — never silently different SQL.

::: warning SQLite and time in projections
SQLite stores `datetime` as text. Entity scanning handles it, but a raw aggregate like `max(due_at)` projected into a `time.Time` field will fail to scan; project into a `string` or aggregate over a numeric column instead.
:::

## Read/write splitting

`WithReplicas` routes untracked SELECTs to replicas round-robin and everything else to the primary:

```go
db := sorm.WithReplicas(pgxd.Wrap(primary),
    pgxd.Wrap(replica1), pgxd.Wrap(replica2))
```

Routing rules:

- `Query` (untracked reads) → next replica.
- `Exec`, `ExecBatch`, `Begin`, `RunInTx` → primary.
- Sessions and generated Contexts → **primary entirely** (read-your-writes: a tracked snapshot from a lagging replica would produce stale diffs and false version conflicts).
- `ForUpdate` / `ForUpdateSkipLocked` → primary.

Explicit overrides for a single query: `sorm.Primary(db)` pins the primary, `sorm.Replica(db)` pins a replica; both are no-ops on plain connections. Health checking and failover belong to the pool — the resolver only routes.

## Schemas and multi-tenancy

`InSchema` binds a connection to a database schema; every table sorm renders becomes schema-qualified. Models stay schema-agnostic, so the same entities can serve different tenants through different wrappers over one pool:

```go
db := sorm.InSchema(pgxd.Wrap(pool), "billing")   // "billing"."orders"
c  := sormgen.NewContext(db)                       // inherits the schema
```

On MySQL a "schema" is a database name; on SQLite, an attached database name. `Raw`/`RawAs` SQL is not rewritten. For migrations, pair with `migrate.WithSchema("billing")`.

Composition order for wrappers: instrumentation outside, `InSchema` in the middle, `WithReplicas` inside.

## The DB interface

Custom adapters implement five methods:

```go
type DB interface {
    Dialect() dialect.Dialect
    Query(ctx context.Context, sql string, args ...any) (Rows, error)
    Exec(ctx context.Context, sql string, args ...any) (int64, error)
    ExecBatch(ctx context.Context, items []BatchItem) error
    Begin(ctx context.Context) (Tx, error)
}
```

and a `Dialect` covers the textual differences:

```go
type Dialect interface {
    Name() string                 // "postgres" | "mysql" | "sqlite"
    Placeholder(n int) string     // $1 or ?
    QuoteIdent(s string) string
    ReturningSupported() bool
}
```

`SQLTypeFor(dialect, columnDef)` is the single mapping point from Go kinds to SQL column types, shared by the DDL generator and migrations.
