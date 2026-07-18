# Examples

A cookbook of complete, copy-paste-ready recipes for every part of sorm. All examples share one domain — the library-lending system from the [Quick Start](./quick-start.md) (`Member`, `Book`, `Loan`, `Genre`, `LibraryCard`) — and show the code, the SQL it produces, and the result. For the underlying rules, follow the links into the reference pages.

[[toc]]

## 1. The smallest possible program

One model, one `gen` run, one file-backed SQLite database — from zero to a persisted row.

```go
// models/models.go
package models

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
package main

import (
    "context"
    "database/sql"
    "fmt"
    "log"

    _ "modernc.org/sqlite" // pure Go, no cgo

    "github.com/dvislobokov/sorm/dialect/lite"
    "github.com/dvislobokov/sorm/driver/sqld"
    "github.com/dvislobokov/sorm/migrate"

    "library/models"
    "library/models/sormgen" // importing it registers the models
)

func main() {
    ctx := context.Background()

    sdb, err := sql.Open("sqlite", "file:library.db")
    if err != nil {
        log.Fatal(err)
    }
    if err := migrate.Apply(ctx, sdb, "sqlite"); err != nil { // schema from registered models
        log.Fatal(err)
    }
    db := sqld.Wrap(sdb, lite.Dialect{})

    c := sormgen.NewContext(db)
    gopl := &models.Book{ISBN: "978-0134190440", Title: "The Go Programming Language", Copies: 2}
    c.Books.Add(gopl)
    if err := c.SaveChanges(ctx); err != nil {
        log.Fatal(err)
    }
    fmt.Println(gopl.ID) // 1 — the generated key is written back
}
```

See [Quick Start](./quick-start.md) for the full walkthrough and [Databases](./databases.md) for PostgreSQL/MySQL connection recipes.

## 2. Defining models: the tag toolbox

Everything lives in the single `sorm:"..."` tag. See [Models](./models.md) for the complete reference.

```go
type Member struct {
    ID       int64     `sorm:"pk,auto"`                 // DB-generated key
    Email    string    `sorm:"unique"`
    Name     string
    JoinedAt time.Time `sorm:"autoCreate"`              // stamped on INSERT
    Version  int64     `sorm:"version"`                 // optimistic concurrency

    Loans []*Loan      `sorm:"hasMany:MemberID"`        // navigation, not a column
    Card  *LibraryCard `sorm:"hasOne:MemberID"`
}

type Loan struct {
    ID         int64      `sorm:"pk,auto"`
    BookID     int64      `sorm:"fk:Book.ID,index:idx_loans_book_member"`
    MemberID   int64      `sorm:"fk:Member.ID,index:idx_loans_book_member"` // composite index
    BorrowedAt time.Time  `sorm:"autoCreate"`
    DueAt      time.Time
    ReturnedAt *time.Time                                // pointer = nullable column
    UpdatedAt  time.Time  `sorm:"autoUpdate"`            // stamped on INSERT and UPDATE

    Book   *Book   `sorm:"belongsTo:BookID"`
    Member *Member `sorm:"belongsTo:MemberID"`
}

type User struct {
    ID        int64          `sorm:"pk,auto"`
    Nickname  string         `sorm:"col:nick"`           // explicit column name
    DeletedAt *time.Time     `sorm:"softDelete"`         // soft deletion
    Prefs     map[string]any `sorm:"json"`               // JSON column
    Secret    string         `sorm:"-"`                  // not a column
}
```

Rules worth remembering:

- Exactly one `pk` field marks a struct as an entity; `auto` works only on integer keys.
- A pointer field is a nullable column — `sql.NullString` and friends are rejected.
- An exported field pointing at another entity **must** carry a relation tag or `sorm:"-"`.

## 3. Code generation, repeatable

Keep regeneration one `go generate` away and let CI catch drift. See [Code Generation](./codegen.md).

```go
// models/models.go
//go:generate go run github.com/dvislobokov/sorm/cmd/sorm gen .
package models
```

```sh
go generate ./models
# sorm: generated 7 file(s) for 5 entit(ies) in models/sormgen
```

The `models/sormgen` package now holds typed column descriptors (`sormgen.Book.Title`), relation descriptors, entity metadata, table definitions, and the `Context` facade. Output is deterministic — regeneration produces stable diffs, so a CI step can verify it is current:

```sh
go generate ./models && git diff --exit-code models/sormgen
```

::: tip
Importing `sormgen` — even blank-imported — is what registers your models with the runtime. Migrations, `sormtest.NewSQLite`, and queries all rely on that registration.
:::

## 4. Insert an object graph

New entities are wired through navigations, not raw FK values. `SaveChanges` inserts parents first, obtains the generated keys, and fills the children's FK columns in — all in one transaction. See [Sessions](./sessions.md#inserting).

```go
c := sormgen.NewContext(db)

ada  := &models.Member{Email: "ada@library.dev", Name: "Ada Lovelace"}
gopl := &models.Book{ISBN: "978-0134190440", Title: "The Go Programming Language",
    Author: "Donovan & Kernighan", Year: 2015, Copies: 2}
c.Members.Add(ada)
c.Books.Add(gopl)

loan := &models.Loan{DueAt: time.Now().AddDate(0, 0, 14)}
loan.Book = gopl    // navigation, not loan.BookID = ...
loan.Member = ada
c.Loans.Add(loan)

err := c.SaveChanges(ctx)
```

```txt
ada.ID=1 gopl.ID=2 loan.ID=1 loan.BookID=2 loan.MemberID=1
autoCreate stamped: joined=true borrowed=true
```

A dependency cycle between new entities in one flush is reported as `sorm.ErrCyclicGraph`.

## 5. Querying: filters, ordering, paging

`sorm.Query[E]` starts an untracked, typed query; builders are immutable, so a base builder can be reused. See [Queries](./queries.md).

```go
b := sormgen.Book

page := 2
books, err := sorm.Query[models.Book](db).
    Where(b.Year.Gte(1990), b.Copies.Gt(0)).   // multiple args are ANDed
    OrderBy(b.Year.Desc(), b.Title.Asc()).
    Limit(10).
    Offset((page - 1) * 10).
    All(ctx)                                    // []*models.Book, empty slice when nothing matches
```

`ToSQL()` shows exactly what will run:

```txt
SQL:  SELECT "id", "isbn", "title", "author", "year", "copies", "version" FROM "books" WHERE ("year" >= ? AND "copies" > ?) ORDER BY "year" DESC, "title" LIMIT 10 OFFSET 10
args: [1990 0]
```

The predicate set depends on the column type — a few common ones:

```go
b.Copies.Eq(0)                  // Eq(0) is a real condition, not "unset"
b.Year.Between(1990, 2010)
b.Title.HasPrefix("The ")       // escaped literal, unlike Like
b.Title.Like("%Go%")
b.ISBN.In("978-0134190440", "978-0262162098")
sormgen.Loan.ReturnedAt.IsNull()
```

## 6. One row, counting, existence, streaming

```go
// exactly one (or ErrNotFound):
book, err := sorm.Query[models.Book](db).Where(b.ISBN.Eq("978-0134190440")).One(ctx)
if errors.Is(err, sorm.ErrNotFound) {
    // 404, not a scan through nil
}

// count:
n, err := sorm.Query[models.Loan](db).Where(sormgen.Loan.ReturnedAt.IsNull()).Count(ctx)

// existence — a Count with Limit(1) reads nicer as:
exists, err := sorm.Query[models.Book](db).Where(b.ISBN.Eq("978-0134190440")).Limit(1).Count(ctx)
_ = exists > 0
```

`Iter` streams rows without materializing the whole result set (`iter.Seq2`, Go 1.23+ range-over-func):

```go
for book, err := range sorm.Query[models.Book](db).OrderBy(b.ID.Asc()).Iter(ctx) {
    if err != nil {
        return err
    }
    export(book)
}
```

::: warning
`Iter` is incompatible with `With` — eager loading needs the full parent set. Such an iterator yields a single error.
:::

## 7. Combining predicates and filtering by relations

`And` / `Or` / `Not` nest arbitrarily; relation descriptors filter the **root** entity through correlated `EXISTS` — no JOINs, no duplicated rows. See [Relations](./relations.md#filtering-by-relations).

```go
m, l, g := sormgen.Member, sormgen.Loan, sormgen.Genre

// (author starts with Donovan) OR (year < 2000 AND copies >= 2)
sorm.Query[models.Book](db).Where(
    sorm.Or(
        b.Author.HasPrefix("Donovan"),
        sorm.And(b.Year.Lt(2000), b.Copies.Gte(2)),
    ),
)

// members with at least one open loan
sorm.Query[models.Member](db).Where(m.Loans.Any(l.ReturnedAt.IsNull()))

// members with no loans at all
sorm.Query[models.Member](db).Where(m.Loans.None())

// loans whose book is tagged "Programming" (belongsTo + many2many, nested)
sorm.Query[models.Loan](db).Where(l.Book.Is(b.Genres.Any(g.Name.Eq("Programming"))))
```

`And()` with no arguments renders TRUE, `Or()` with no arguments renders FALSE — safe for building predicate lists dynamically.

## 8. Typed subqueries

Subqueries carry their value type: an `int64` subquery cannot meet a `string` column. Build the inner query with a `nil` db — rendering follows the outer query's dialect. See [Queries](./queries.md#subqueries).

```go
// books that have ever been loaned: id IN (SELECT book_id FROM loans)
loaned := sorm.Pick(l.BookID, sorm.Query[models.Loan](nil))
books, err := sorm.Query[models.Book](db).
    Where(sorm.InQuery(b.ID, loaned)).
    All(ctx)

// books published in the newest year on the shelf: year = (SELECT max(year) FROM books)
maxYear := sorm.PickScalar(sorm.Max[models.Book, int](b.Year), sorm.Query[models.Book](nil))
newest, err := sorm.Query[models.Book](db).
    Where(sorm.EqQ(b.Year, maxYear)).
    All(ctx)
```

Available comparisons: `InQuery`, `NotInQuery`, `EqQ`, `NeqQ`, `GtQ`, `GteQ`, `LtQ`, `LteQ`.

## 9. Update through change tracking

No `Update` call in the session world — load, mutate with plain Go, save. `SaveChanges` diffs against the load-time snapshot and updates only the changed columns. See [Sessions](./sessions.md).

```go
c := sormgen.NewContext(db)

book, err := c.Books.Where(b.ISBN.Eq("978-0134190440")).One(ctx) // tracked
book.Copies = 5                                                   // plain mutation
err = c.SaveChanges(ctx)                                          // minimal diff
```

The only statement executed (captured via `sorm.Instrument`):

```txt
UPDATE "books" SET "copies" = ?, "version" = "version" + 1 WHERE "id" = ? AND "version" = ?
```

Identity-map behavior worth knowing:

```go
b1, _ := c.Books.Find(ctx, book.ID)  // identity map first — no SQL, same pointer
b1 == book                            // true

// large read-only listings: skip tracking entirely
list, _ := c.Books.NoTracking().OrderBy(b.Title.Asc()).All(ctx)
```

A `SaveChanges` with no changes executes no SQL at all.

## 10. Deleting, and soft delete

```go
// hard delete through the session (children before parents, one transaction):
loans, _ := c.Loans.Where(l.MemberID.Eq(ada.ID)).All(ctx)
c.Loans.Remove(loans...)
err := c.SaveChanges(ctx)
```

For an entity with a `softDelete` field, `Remove` becomes an UPDATE stamping the timestamp, and every query filters deleted rows implicitly:

```go
type User struct {
    ID        int64      `sorm:"pk,auto"`
    Email     string     `sorm:"unique"`
    DeletedAt *time.Time `sorm:"softDelete"`
}

sorm.Query[models.User](db).All(ctx)                // live rows only
sorm.Query[models.User](db).WithDeleted().All(ctx)  // everything
sorm.Query[models.User](db).OnlyDeleted().All(ctx)  // trash-bin view

// real purge, bypassing the soft delete:
n, err := sorm.Delete[models.User](db).Where(u.DeletedAt.IsNotNull()).Hard().Exec(ctx)
```

See [Models](./models.md#soft-delete).

## 11. Transactions with RunInTx

The generated context wraps `sorm.RunInTx`: commit on `nil`, rollback on error, automatic retry of transient failures (deadlock, serialization) with exponential backoff, up to 3 retries. See [Sessions](./sessions.md#transactions).

```go
err := c.RunInTx(ctx, func(txc *sormgen.Context) error {
    book, err := txc.Books.Find(ctx, bookID)
    if err != nil {
        return err
    }
    if book.Copies == 0 {
        return errors.New("no copies available") // -> rollback
    }
    book.Copies--
    txc.Loans.Add(&models.Loan{DueAt: due, Book: book, Member: member})
    return txc.SaveChanges(ctx) // flushes inside this transaction
})
```

```txt
commit err: <nil>
rollback err: business rule: negative stock
copies after rollback: 2
```

Each retry attempt gets a **fresh child context** — work only through `txc` inside the closure, and keep non-database side effects idempotent (`fn` may run more than once). For a transaction you manage yourself, use `SaveChangesTx(ctx, tx)` or construct the session over an open `Tx`.

Row locking for queue workers (PostgreSQL/MySQL only):

```go
err := sorm.RunInTx(ctx, db, func(tx sorm.Tx) error {
    job, err := sorm.Query[models.Job](tx).
        Where(j.State.Eq("pending")).
        ForUpdateSkipLocked().
        One(ctx)
    // ...
    return nil
})
```

## 12. Optimistic concurrency

A `Version int64` field tagged `sorm:"version"` puts `AND version = ?` on every session UPDATE/DELETE. A lost update surfaces as `*sorm.ConflictError`, never as silent data loss. See [Sessions](./sessions.md#optimistic-concurrency).

```go
c1, c2 := sormgen.NewContext(db), sormgen.NewContext(db)
b1, _ := c1.Books.Find(ctx, id)
b2, _ := c2.Books.Find(ctx, id)

b1.Copies = 10
_ = c1.SaveChanges(ctx)      // ok, version 1 -> 2

b2.Copies = 99
err := c2.SaveChanges(ctx)   // stale version
```

```txt
second save -> ConflictError: true | sorm: concurrency conflict on books pk=2 (row changed or deleted since load)
```

```go
var conflict *sorm.ConflictError
if errors.As(err, &conflict) {
    // conflict.Table == "books", conflict.PK == 2
    // reload, merge, retry — or surface HTTP 409
}
```

Set-based `Update` builders bump the version too, so they cooperate with open sessions instead of hiding behind them.

## 13. Eager loading with With / Include

One extra query per include, distributed to parents in memory — no row-multiplying JOINs. Includes take child filters, child ordering, and nested includes. See [Relations](./relations.md#eager-loading-with-with--include).

```go
members, err := sorm.Query[models.Member](db).
    With(
        m.Card.Include(),                 // hasOne
        m.Loans.Include(                  // hasMany with options:
            l.ReturnedAt.IsNull(),        //   child filter
            l.DueAt.Asc(),                //   child ordering
            l.Book.Include(),             //   nested include (ThenInclude analog)
        ),
    ).
    OrderBy(m.ID.Asc()).
    All(ctx)
```

```txt
Ada Lovelace card=LC-1001 loans=2
  due 2026-07-20: Structure and Interpretation of Computer Programs
  due 2026-07-27: The Go Programming Language
Grace Hopper card=LC-1002 loans=0
```

After a `hasMany` include, an empty slice means "loaded, none matched"; `nil` means "not loaded". Includes work from sets too (`c.Members.With(...)`) — the materialized entities are then tracked.

## 14. many2many: Link and Unlink

sorm does not guess collection diffs for many-to-many — linking is an explicit operation on the descriptor. Both sides must already be persisted. See [Relations](./relations.md#many2many-link-and-unlink).

```go
err := sormgen.Book.Genres.Link(ctx, db, gopl, csGenre, progGenre) // INSERT into book_genres
err  = sormgen.Book.Genres.Unlink(ctx, db, gopl, progGenre)        // DELETE from book_genres

// linking the same pair twice violates the join table's composite PK:
if sorm.IsUniqueViolation(err) { /* already linked — usually fine */ }
```

Loading and filtering work like any other relation:

```go
books, err := sorm.Query[models.Book](db).
    With(b.Genres.Include(g.Name.Asc())).
    Where(b.Genres.Any(g.Name.Eq("Programming"))).
    All(ctx)
```

## 15. Projections, aggregates, joins

Report shapes come from `sorm.From[E]` + `sorm.Project` into an arbitrary struct; matching is strict — a mismatch is a `*sorm.ScanError`, never a silently dropped field. See [Projections](./projections.md).

```go
type memberStat struct {
    MemberID int64 `sorm:"member_id"`
    Loans    int64 `sorm:"loans"`
    MaxYear  int64 `sorm:"max_year"`
}

stats, err := sorm.Project[memberStat](
    sorm.From[models.Loan](db).
        Join(sorm.InnerJoinOn(sorm.ColEq(b.ID, l.BookID))).
        GroupBy(l.MemberID).
        Having(sorm.CountAll[models.Loan]().Gte(1)),
    sorm.Field(l.MemberID),
    sorm.As(sorm.CountAll[models.Loan](), "loans"),
    sorm.As(sorm.Max[models.Loan, int](b.Year), "max_year"),
).All(ctx)
```

```txt
member 1: 2 loans, newest book year 2015
```

Engine-specific aggregates live in `pgagg` (PostgreSQL) and `myagg` (MySQL); using them on the wrong dialect is an explicit error at execution, never wrong SQL:

```go
import "github.com/dvislobokov/sorm/pgagg"

rows, err := sorm.Project[shelf](
    sorm.From[models.Book](db).GroupBy(b.Author),
    sorm.Field(b.Author),
    sorm.As(pgagg.StringAgg[models.Book](b.Title, "; "), "titles"),
).All(ctx)
```

Anything else can be assembled from parts with `NewAgg` (`AggRaw`, `AggCol`, `AggArg`, `AggLit`, `AggDialect`) — that is exactly how `pgagg`/`myagg` are built.

## 16. Set-based Update, Delete, Upsert

Bulk statements skip the session (and bypass [lifecycle hooks](./models.md#lifecycle-hooks)) — the EF Core `ExecuteUpdate`/`ExecuteDelete` analog. See [Queries](./queries.md#set-based-writes).

```go
// UPDATE ... WHERE — version column bumped automatically
n, err := sorm.Update[models.Book](db).
    Set(b.Copies.Set(7)).
    Where(b.ISBN.Eq("978-0262162098")).
    Exec(ctx)

// DELETE returned loans
n, err = sorm.Delete[models.Loan](db).
    Where(l.ReturnedAt.IsNotNull()).
    Exec(ctx)

// a statement without Where is an error unless you mean it:
n, err = sorm.Update[models.Book](db).Set(b.Copies.Set(0)).AllRows().Exec(ctx)
```

Multi-row upsert (`ON CONFLICT` on PostgreSQL/SQLite, `ON DUPLICATE KEY` on MySQL):

```go
n, err := sorm.Upsert[models.Book](db).
    Rows(book1, book2).
    OnConflict(b.ISBN).          // conflict target (ignored on MySQL — any unique key fires)
    DoUpdate(b.Author, b.Year).  // overwrite these columns from the incoming values
    Exec(ctx)
```

```txt
upsert affected=1 author now="Benjamin C. Pierce" copies kept=7
```

`DoNothing()` skips conflicting rows instead. Auto-generated PKs are **not** written back by `Upsert` — reload if you need the keys.

## 17. Raw SQL escape hatch

Two hatches, both with strict column matching. `Raw` scans into entities via their metadata; `RawAs` scans into any struct — CTEs, window functions, anything. See [Queries](./queries.md#raw-sql).

```go
// entities from hand-written SQL:
soon, err := sorm.Raw[models.Loan](db,
    `SELECT * FROM loans WHERE returned_at IS NULL AND due_at < ?`,
    time.Now().AddDate(0, 0, 10)).All(ctx)

// arbitrary result shape — mapping by sorm:"col" tag or snake_case of the field:
type shelf struct {
    Author string `sorm:"author"`
    Titles int64  `sorm:"titles"`
}
shelves, err := sorm.RawAs[shelf](db,
    `SELECT author, count(*) AS titles FROM books GROUP BY author ORDER BY author`).All(ctx)
```

```txt
Abelson & Sussman: 1
Benjamin C. Pierce: 1
Donovan & Kernighan: 1
```

A column/field mismatch returns a `*sorm.ScanError` listing the `Missing` and `Extra` columns. Placeholders follow the connection's dialect (`$1` on PostgreSQL, `?` on MySQL/SQLite), and `InSchema` does not rewrite raw SQL.

## 18. Migrations: declarative, versioned, seeded

Declarative for development — diff the live database against the registered models and apply exactly what is missing. See [Migrations](./migrations.md).

```go
import (
    "github.com/dvislobokov/sorm/migrate"
    _ "library/models/sormgen" // registers the desired schema
)

stmts, err := migrate.Plan(ctx, sdb, "postgres")  // dry run — print, review
err = migrate.Apply(ctx, sdb, "postgres")         // apply; advisory-locked across replicas
```

Versioned for production — SQL files reviewed in PRs, applied in order, protected by checksums:

```sh
go run github.com/dvislobokov/sorm/cmd/sorm migrate diff \
    -dialect postgres -dir migrations -dev-dsn "postgres://localhost/scratch" \
    add_loans ./models
# sorm: created migration migrations/20260713085554_add_loans.sql (+ .down.sql, sorm.sum)
```

```go
applied, err := migrate.Up(ctx, sdb, "postgres", "migrations")     // on startup or from CI
pending, err := migrate.Pending(ctx, sdb, "postgres", "migrations")
reverted, err := migrate.Down(ctx, sdb, "postgres", "migrations", 1) // roll back last N
```

One-time data seeds, recorded in the same history table — re-running on new deploys or other replicas is a no-op:

```go
err := migrate.Seed(ctx, sdb, "postgres", "default-admin",
    func(ctx context.Context, tx *sql.Tx) error {
        _, err := tx.ExecContext(ctx,
            `INSERT INTO users (email, name, active, created_at, version)
             VALUES ($1, $2, true, now(), 1)`, "admin@corp.io", "Admin")
        return err
    })
```

::: tip
Migrations always take a `*sql.DB`. On PostgreSQL open a `database/sql` handle with the `pgx` stdlib driver for migrations, and a `pgxpool` for the runtime.
:::

## 19. Dialects, read replicas, multi-tenancy

The same models and queries run on all three engines — only the connection wiring differs. See [Databases](./databases.md).

```go
// PostgreSQL — pgx pool, one roundtrip per write batch
pool, _ := pgxpool.New(ctx, dsn)
db := pgxd.Wrap(pool)

// MySQL — always parseTime=true so time.Time scans correctly
sdb, _ := sql.Open("mysql", dsn+"?parseTime=true")
db := sqld.Wrap(sdb, my.Dialect{})

// SQLite in-memory — lives in a single connection
sdb, _ := sql.Open("sqlite", ":memory:")
sdb.SetMaxOpenConns(1)
db := sqld.Wrap(sdb, lite.Dialect{})
```

Read/write splitting — untracked SELECTs round-robin over replicas, everything else (writes, transactions, sessions, `ForUpdate`) stays on the primary:

```go
db := sorm.WithReplicas(pgxd.Wrap(primary), pgxd.Wrap(replica1), pgxd.Wrap(replica2))

fresh, _ := sorm.Query[models.Book](sorm.Primary(db)).All(ctx) // pin one query to the primary
```

Per-schema multi-tenancy — models stay schema-agnostic, the wrapper qualifies every table:

```go
billing := sorm.InSchema(pgxd.Wrap(pool), "billing")  // "billing"."loans"
c := sormgen.NewContext(billing)                      // the whole unit of work in that schema
```

Composition order for wrappers: instrumentation outside, `InSchema` in the middle, `WithReplicas` inside.

## 20. Observability: Instrument, query names, OpenTelemetry

One middleware seam sees every operation — queries, execs, batches, begin/commit/rollback. See [Observability](./observability.md).

```go
db = sorm.Instrument(db, func(ctx context.Context, op sorm.Op, next func(context.Context) error) error {
    start := time.Now()
    err := next(ctx)
    slog.Info("sql", "kind", op.Kind, "sql", op.SQL, "dur", time.Since(start), "err", err)
    return err
})
```

Name queries so telemetry aggregates by operation, not by SQL text:

```go
sorm.Query[models.Book](db).Named("catalog.recent").Where(...).All(ctx) // builder-level
ctx = sorm.WithQueryName(ctx, "checkout")                                // context-level (wins)
```

OpenTelemetry spans and metrics in one line:

```go
import "github.com/dvislobokov/sorm/otelsorm"

db = otelsorm.Wrap(db,
    otelsorm.WithPoolStats(func() otelsorm.PoolStats {
        s := pool.Stat()
        return otelsorm.PoolStats{
            Max: int64(s.MaxConns()), Idle: int64(s.IdleConns()),
            Used: int64(s.AcquiredConns()),
            WaitCount: s.EmptyAcquireCount(), WaitDuration: s.AcquireDuration(),
        }
    }),
)
```

Recorded metrics include `db.client.operation.duration`, `sorm.db.statements`, `sorm.db.errors` (by typed error class), `sorm.tx.duration`, and `sorm.tx.retries`. SQL text stays on spans, never in metric attributes; query args are off by default (`WithArgs()` opts in).

## 21. Testing with sormtest

A test pyramid without mocking `sorm.DB`. See [Observability and Testing](./observability.md#testing-with-sormtest).

```go
// 1. Query construction — no database at all:
func TestRecentBooksQuery(t *testing.T) {
    q := sorm.Query[models.Book](nil).
        Where(sormgen.Book.Year.Gte(1990)).
        OrderBy(sormgen.Book.Year.Desc())
    sormtest.AssertSQL(t, q,
        `SELECT "id", "isbn", "title", "author", "year", "copies", "version" FROM "books" WHERE "year" >= $1 ORDER BY "year" DESC`,
        1990)
}

// 2. Data-access code — in-memory SQLite with the real schema, safe under t.Parallel():
func TestCheckout(t *testing.T) {
    db := sormtest.NewSQLite(t)                       // schema applied, closed via t.Cleanup
    sormtest.Load(t, db, "testdata/library.yaml")     // YAML fixtures, inserted FK-first

    db, queries := sormtest.CountQueries(db)          // 3. N+1 guard
    page, err := sorm.Query[models.Member](db).
        With(sormgen.Member.Loans.Include(sormgen.Loan.Book.Include())).
        All(ctx)
    if err != nil {
        t.Fatal(err)
    }
    if queries.Selects() > 3 {
        t.Fatalf("N+1: %d selects for one page", queries.Selects())
    }
    _ = page
}
```

```yaml
# testdata/library.yaml — raw rows: every NOT NULL column must be present
members:
  - {id: 1, email: ada@library.dev, name: Ada, joined_at: 2026-01-01T00:00:00Z, version: 1}
loans:
  - {id: 1, book_id: 1, member_id: 1, borrowed_at: 2026-01-02T00:00:00Z,
     due_at: 2026-01-16T00:00:00Z, updated_at: 2026-01-02T00:00:00Z}
```

For PostgreSQL-only features (arrays, `pgagg`, `ForUpdate`) use `sormtest.NewPostgres(t)` — each test binds to a fresh schema in the server pointed to by `SORM_TEST_DSN` and is skipped when the variable is unset.

## 22. Error handling, all the cases

Every failure mode is a typed error — no parsing of driver codes or SQL text. See [Sessions](./sessions.md#typed-errors).

```go
err := c.SaveChanges(ctx)

var conflict *sorm.ConflictError
var ce *sorm.ConstraintError
var se *sorm.ScanError
switch {
case errors.Is(err, sorm.ErrNotFound):
    // One/Find matched nothing — the single not-found sentinel across the API
case errors.As(err, &conflict):
    // optimistic concurrency: row changed or vanished since load (conflict.Table, conflict.PK)
case errors.As(err, &ce) && ce.Kind == sorm.ConstraintUnique:
    // "email already taken" -> HTTP 409
case errors.As(err, &ce) && ce.Kind == sorm.ConstraintForeignKey:
    // referenced row is gone
case errors.As(err, &se):
    // Raw/RawAs/Project column mismatch: se.Missing / se.Extra list the columns
case errors.Is(err, sorm.ErrCyclicGraph):
    // dependency cycle between new entities in one flush
case err != nil:
    // driver/network error — instrumented, classified for RunInTx retries
    return err
}
```

The one-line shorthand for the most common case:

```go
if sorm.IsUniqueViolation(err) { /* duplicate — 409 or ignore */ }
```

`ConstraintError.Kind` values: `ConstraintUnique`, `ConstraintForeignKey`, `ConstraintNotNull`, `ConstraintCheck`.
