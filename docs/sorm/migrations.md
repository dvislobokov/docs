# Migrations

The `sorm/migrate` package derives the desired schema from your registered models and reconciles the database with it, powered by the Atlas engine as a Go dependency — no external CLI. Two workflows are supported: declarative (`Apply`/`Plan`) for development and simple deployments, and versioned SQL files for review-driven production pipelines.

The sorm runtime does not depend on Atlas; the dependency links only when you import `sorm/migrate`.

## Declarative: Apply and Plan

`Apply` inspects the live database, diffs it against the registered `TableDef`s (import your `sormgen` package for its side effect), and applies exactly the missing DDL:

```go
import (
    "database/sql"
    "github.com/dvislobokov/sorm/migrate"
    _ "library/models/sormgen"   // registers the desired schema
)

sdb, _ := sql.Open("sqlite", "file:library.db")
err := migrate.Apply(ctx, sdb, "sqlite")   // "postgres" | "mysql" | "sqlite"
```

`Plan` returns the SQL without executing — dry-run and review:

```go
stmts, err := migrate.Plan(ctx, sdb, "sqlite")
```

Verified output on an empty database (excerpt), and after applying:

```txt
== migrate.Plan ==
CREATE TABLE `books` (`id` integer NOT NULL PRIMARY KEY AUTOINCREMENT, `isbn` text NOT NULL, `title` text NOT NULL, `author` text NOT NULL, `year` integer NOT NULL, `copies` integer NOT NULL, `version` integer NOT NULL)
CREATE UNIQUE INDEX `books_isbn_key` ON `books` (`isbn`)
CREATE INDEX `idx_books_title` ON `books` (`title`)
CREATE TABLE `book_genres` (`book_id` integer NOT NULL, `genre_id` integer NOT NULL, PRIMARY KEY (`book_id`, `genre_id`), CONSTRAINT `book_genres_book_id_fkey` FOREIGN KEY (`book_id`) REFERENCES `books` (`id`), ...)
...
-- applied; second Plan: []
```

Guarantees:

- The comparison is **limited to sorm tables** — foreign tables in the same database are left alone.
- Concurrent `Apply` calls (several replicas starting up) serialize on an advisory lock.
- `migrate.WithSchema("billing")` scopes inspection and diffing to a named schema — pair it with `sorm.InSchema` on the runtime side.

::: tip
`Apply` takes a `*sql.DB`, not a `sorm.DB`. On PostgreSQL open a `database/sql` handle with the `pgx` stdlib driver for migrations, and a `pgxpool` for the runtime.
:::

## Versioned migrations

For CI and production review, generate SQL files and apply them in order.

### Generating a diff

```sh
go run github.com/dvislobokov/sorm/cmd/sorm migrate diff -dialect sqlite -dir migrations init ./models
```

```txt
sorm: created migration migrations\20260713085554_init.sql
```

The directory now contains an up file, a down file, and a checksum file:

```txt
migrations/
  20260713085554_init.sql
  20260713085554_init.down.sql
  sorm.sum
```

Diffing replays existing migrations onto an empty scratch database and diffs the result against the models. On SQLite the scratch database is in-memory by default; PostgreSQL and MySQL need one provisioned by you:

```sh
go run github.com/dvislobokov/sorm/cmd/sorm migrate diff \
    -dialect postgres -dir migrations -dev-dsn "postgres://localhost/scratch" \
    add_loans ./models
```

From Go code the equivalent is `migrate.Diff(ctx, dev, dialect, dir, name)` — importing `sormgen`, so custom `Indexes()` methods are included (the CLI cannot execute model code and warns about them).

### Applying

```sh
go run github.com/dvislobokov/sorm/cmd/sorm migrate up -dsn "$DSN" -dialect postgres -dir migrations
```

Or from code (e.g. on service startup):

```go
applied, err := migrate.Up(ctx, sdb, "postgres", "migrations")
```

- Files apply in name order; applied names are recorded in the `sorm_migrations` history table.
- PostgreSQL and SQLite run each file in a transaction; MySQL commits DDL implicitly, so files execute statement by statement.
- Concurrent `Up` calls serialize on an advisory lock — a file is never applied twice.
- `Pending(ctx, db, dialect, dir)` lists what `Up` would apply, without applying.

### Rolling back

```go
reverted, err := migrate.Down(ctx, sdb, "postgres", "migrations", 1)  // last N migrations
```

`Down` uses the `*.down.sql` files (newest first) and removes history records. A migration without a down file stops the rollback with an error.

### Checksums

`sorm.sum` pins the content of every migration file:

```txt
h1:df2e0728d99f66bc...  20260713085554_init.down.sql
h1:7d2b1ac919baf10c...  20260713085554_init.sql
```

`Diff` maintains it; `Up` verifies it. `migrate.VerifySum(dir)` checks explicitly and returns a `*migrate.SumError` listing modified, missing, and extra files. `WriteSum(dir)` recomputes it after intentional edits.

## Seeds

`Seed` runs a named one-time data seed, recorded in the same history table as `seed:<name>` — repeat calls on new deploys or other replicas are no-ops, and concurrent callers serialize on the migration lock. The seed and its history record commit in one transaction:

```go
err := migrate.Seed(ctx, sdb, "postgres", "default-admin",
    func(ctx context.Context, tx *sql.Tx) error {
        _, err := tx.ExecContext(ctx,
            `INSERT INTO users (email, name, active, created_at, version)
             VALUES ($1, $2, true, now(), 1)`, "admin@corp.io", "Admin")
        return err
    })
```

Rename the seed to run a new version of it; mutations to already-seeded data belong in a new seed with a new name. `SeedApplied(ctx, db, dialect, name)` reports whether a seed has run.

## Choosing a workflow

| | Declarative (`Apply`) | Versioned (`diff` + `up`) |
|---|---|---|
| DDL review in PRs | no — computed at runtime | yes — SQL files in the repo |
| Setup | zero | scratch DB for PG/MySQL diffs |
| Rollback | re-apply older models | `Down` with `*.down.sql` |
| Best for | development, tests, small services | CI/CD pipelines, production |

Both workflows read the same model definitions, so switching later does not change your models.
