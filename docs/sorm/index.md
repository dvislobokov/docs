# sorm

sorm is a Go ORM built around a real **Unit of Work**: load entities, mutate them with plain Go code, and call `SaveChanges` — the session computes a minimal diff and applies it in ordered batches inside a single transaction. Queries are fully typed through generated column descriptors, so a condition on the wrong entity or the wrong value type is a compile-time error.

## Why a Unit of Work

Most Go ORMs make you call `Save(obj)` and re-write every column, or hand-craft UPDATE statements. sorm follows the EF Core / Hibernate model instead:

- **Identity map** — reloading the same row returns the already-tracked pointer; local changes are never silently overwritten.
- **Snapshot change tracking** — the session snapshots each tracked entity at load time; `SaveChanges` diffs field by field and updates only the columns that changed.
- **Topological write ordering** — DELETEs run children-before-parents, INSERTs run by dependency level with `RETURNING`/`LastInsertId` foreign-key fixup, all in one transaction, batched.
- **Optimistic concurrency** — a `version` column is checked on every UPDATE/DELETE; a lost update surfaces as a typed `*sorm.ConflictError`, never as silent data loss.

```go
c := sormgen.NewContext(db)                    // unit of work: session + typed sets

book, err := c.Books.Where(gen.Book.ISBN.Eq("978-0134190440")).One(ctx)
book.Copies = 5                                // plain Go mutation — tracked

c.Loans.Add(&models.Loan{DueAt: due, Book: book, Member: member})

err = c.SaveChanges(ctx)                       // one transaction, minimal diff
```

The single UPDATE it produced in the verified example, captured via `sorm.Instrument`:

```txt
UPDATE "books" SET "copies" = ?, "version" = "version" + 1 WHERE "id" = ? AND "version" = ?
```

## Feature overview

- **Typed queries** — generated column descriptors, predicates (`Eq`, `In`, `Between`, `HasPrefix`, ...), `And`/`Or`/`Not`, ordering, paging, `One`/`All`/`Count`, streaming with `Iter`, typed subqueries, `ToSQL()` inspection.
- **Relations** — `hasMany`, `belongsTo`, `hasOne`, `many2many`; eager loading via `With(...Include(...))` with nested includes, child filters and ordering; relation predicates (`Any`, `None`, `Is`) rendered as `EXISTS`.
- **Projections** — `Project` into arbitrary structs, aggregates (`Count`, `Sum`, `Avg`, `Min`, `Max`, custom via `NewAgg`), `GROUP BY`/`HAVING`, typed JOINs; PostgreSQL (`pgagg`) and MySQL (`myagg`) aggregate libraries.
- **Set-based statements** — `Update`/`Delete` builders with an `AllRows()` anti-footgun, multi-row `Upsert` (`ON CONFLICT` / `ON DUPLICATE KEY`).
- **Schema features** — soft delete, auto timestamps, JSON columns with typed accessors, PostgreSQL arrays, custom scalars (`driver.Valuer`/`sql.Scanner`), UUID keys, indexes from tags or an `Indexes()` method.
- **Migrations** — declarative `migrate.Apply`/`Plan` (Atlas engine, no external CLI), versioned file migrations with checksums, `Down`, advisory-locked concurrent startup, one-time `Seed`s.
- **Raw SQL escape hatches** — `Raw` (scan into entities) and `RawAs` (scan into any struct) with strict column matching.
- **Production toolkit** — typed errors, lifecycle hooks, read replicas (`WithReplicas`), per-schema multi-tenancy (`InSchema`), `Instrument` middleware, OpenTelemetry tracing and metrics (`otelsorm`), a testing package (`sormtest`).

## Supported databases

| Database | Driver adapter | Underlying driver | Dialect |
|---|---|---|---|
| PostgreSQL | `sorm/driver/pgxd` | `jackc/pgx/v5` (pool, conn, or tx) | `dialect/pg` |
| MySQL | `sorm/driver/sqld` | `go-sql-driver/mysql` | `dialect/my` |
| SQLite | `sorm/driver/sqld` | `modernc.org/sqlite` (pure Go, no cgo) | `dialect/lite` |

## Installation

Requires Go 1.25 or newer.

```sh
go get github.com/dvislobokov/sorm
```

The code generator runs with `go run` — no separate binary to install:

```sh
go run github.com/dvislobokov/sorm/cmd/sorm gen ./models
```

## A minimal end-to-end example

```go
// models/models.go
type Book struct {
    ID      int64  `sorm:"pk,auto"`
    ISBN    string `sorm:"unique"`
    Title   string
    Copies  int
    Version int64 `sorm:"version"`
}
```

```sh
go run github.com/dvislobokov/sorm/cmd/sorm gen ./models   # -> models/sormgen
```

```go
sdb, _ := sql.Open("sqlite", "file:library.db")
_ = migrate.Apply(ctx, sdb, "sqlite")          // schema from the registered models
db := sqld.Wrap(sdb, lite.Dialect{})

c := sormgen.NewContext(db)
c.Books.Add(&models.Book{ISBN: "978-0134190440", Title: "The Go Programming Language", Copies: 2})
if err := c.SaveChanges(ctx); err != nil { ... }
```

Continue with the [Quick Start](./quick-start.md) for the full walkthrough, or jump to [Models](./models.md), [Queries](./queries.md), and [Sessions](./sessions.md).

Source: [github.com/dvislobokov/sorm](https://github.com/dvislobokov/sorm)
