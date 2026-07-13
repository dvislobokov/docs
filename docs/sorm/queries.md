# Queries

`sorm.Query[E]` starts a typed query over an entity. Conditions are built from generated column descriptors, so a predicate on the wrong entity or with the wrong value type does not compile. Builders are immutable — every method returns a copy, and a base builder can be reused safely.

All examples on this page use the library domain from the [Quick Start](./quick-start.md) and were executed against SQLite.

## Basics

```go
b := sormgen.Book

books, err := sorm.Query[models.Book](db).
    Where(b.Year.Gte(1990), b.Copies.Gt(0)).   // multiple args are ANDed
    OrderBy(b.Year.Desc(), b.Title.Asc()).
    Limit(10).
    All(ctx)
```

`ToSQL()` returns the final SQL and arguments:

```txt
SQL:  SELECT "id", "isbn", "title", "author", "year", "copies", "version" FROM "books" WHERE ("year" >= ? AND "copies" > ?) ORDER BY "year" DESC, "title" LIMIT 10
args: [1990 0]
```

### Terminal methods

| Method | Result |
|---|---|
| `All(ctx)` | `[]*E` — empty slice (not nil error) when nothing matches |
| `One(ctx)` | `*E` — first row, or `sorm.ErrNotFound` |
| `Count(ctx)` | `int64` |
| `Iter(ctx)` | `iter.Seq2[*E, error]` — streaming, see below |

```go
_, err = sorm.Query[models.Book](db).Where(b.ISBN.Eq("missing")).One(ctx)
errors.Is(err, sorm.ErrNotFound) // true
```

## Predicates

Which predicates a column offers depends on its descriptor type — see the [type table](./models.md#supported-field-types).

```go
b.Copies.Eq(0)                  // equality: Eq, Neq, In, NotIn
b.Year.Between(1990, 2010)      // ordered: Gt, Gte, Lt, Lte, Between
b.Title.HasPrefix("The ")       // strings: Contains, HasPrefix, HasSuffix (escaped literals)
b.Title.Like("%Go%")            // Like / ILike take a ready-made pattern
gen.Loan.ReturnedAt.IsNull()    // nullable columns: IsNull / IsNotNull
```

Combine with `And`, `Or`, `Not`:

```go
sorm.Query[models.Book](db).Where(
    sorm.Or(
        b.Author.HasPrefix("Donovan"),
        sorm.And(b.Year.Lt(2000), b.Copies.Gte(2)),
    ),
)
```

Multiple `Where` calls and multiple arguments to one `Where` are ANDed. `And()` with no arguments is TRUE, `Or()` with no arguments is FALSE.

::: tip
`Eq(0)` and `Eq(false)` are real conditions. Predicates have no notion of a zero value — what you write is what renders.
:::

### Relation predicates

Relations produce `EXISTS`-based predicates without joins — see [Relations](./relations.md#filtering-by-relations):

```go
m := sormgen.Member
l := sormgen.Loan

// members with at least one open loan
borrowers, err := sorm.Query[models.Member](db).
    Where(m.Loans.Any(l.ReturnedAt.IsNull())).
    All(ctx)
```

## Subqueries

Subqueries are typed: `SubQ[V]` produces values of type `V`, and the compiler will not let an `int64` subquery meet a `string` column. The inner builder is created with a `nil` db — rendering is driven by the outer query's dialect.

```go
// books that have ever been loaned: id IN (SELECT book_id FROM loans)
loaned := sorm.Pick(l.BookID, sorm.Query[models.Loan](nil))
books, err := sorm.Query[models.Book](db).
    Where(sorm.InQuery(b.ID, loaned)).
    All(ctx)

// books published in the newest year on the shelf:
// year = (SELECT max(year) FROM books)
maxYear := sorm.PickScalar(sorm.Max[models.Book, int](b.Year), sorm.Query[models.Book](nil))
newest, err := sorm.Query[models.Book](db).
    Where(sorm.EqQ(b.Year, maxYear)).
    All(ctx)
```

Available comparisons: `InQuery`, `NotInQuery`, `EqQ`, `NeqQ`, `GtQ`, `GteQ`, `LtQ`, `LteQ`. Correlated subqueries are covered by the relation predicates `Any`/`None`/`Is`.

::: warning
`NotInQuery` inherits SQL's `NOT IN` semantics: if the subquery returns a NULL, nothing matches. Filter NULLs out in the subquery.
:::

## Streaming

`Iter` yields rows as they are read, without loading the whole result set:

```go
for book, err := range sorm.Query[models.Book](db).OrderBy(b.ID.Asc()).Iter(ctx) {
    if err != nil {
        return err
    }
    process(book)
}
```

`Iter` is incompatible with `With` (eager loading needs the full parent set) — such an iterator yields a single error.

## Row locking

Inside a transaction, `ForUpdate()` renders `SELECT ... FOR UPDATE`; `ForUpdateSkipLocked()` adds `SKIP LOCKED` — the standard queue-worker pattern. PostgreSQL and MySQL only; building on SQLite is an error.

```go
err := sorm.RunInTx(ctx, db, func(tx sorm.Tx) error {
    job, err := sorm.Query[models.Job](tx).
        Where(j.State.Eq("pending")).
        ForUpdateSkipLocked().
        One(ctx)
    // ...
})
```

## Soft-delete filters

For entities with a `softDelete` field, every query filters deleted rows out implicitly. Override per query:

```go
sorm.Query[models.User](db).WithDeleted()   // all rows
sorm.Query[models.User](db).OnlyDeleted()   // trash-bin view
```

## Set-based writes

Set-based statements skip the session (and [bypass hooks](./models.md#lifecycle-hooks)) — the EF Core `ExecuteUpdate`/`ExecuteDelete` analog.

### Update

```go
n, err := sorm.Update[models.Book](db).
    Set(b.Copies.Set(7)).
    Where(b.ISBN.Eq("978-0262162098")).
    Exec(ctx)
```

```txt
SQL:  UPDATE "books" SET "copies" = ?, "version" = "version" + 1 WHERE "isbn" = ? [7 978-0262162098]
updated rows: 1
```

For versioned entities the version column is incremented automatically, so open sessions still catch conflicts. `Set(0)` and `Set(false)` are full-fledged assignments; `SetNull()` assigns SQL NULL.

### Delete

```go
n, err := sorm.Delete[models.Loan](db).
    Where(l.ReturnedAt.IsNotNull()).
    Exec(ctx)
```

An `Update` or `Delete` without `Where` is an error unless you explicitly opt in with `AllRows()`. For soft-delete entities, `Delete` stamps the column; `Hard()` forces a real DELETE.

### Upsert

```go
n, err := sorm.Upsert[models.Book](db).
    Rows(book1, book2).
    OnConflict(b.ISBN).          // conflict target (PG/SQLite; ignored on MySQL)
    DoUpdate(b.Author, b.Year).  // overwrite from the incoming values
    Exec(ctx)
```

Verified behavior — the conflicting row was updated, columns outside `DoUpdate` kept their values:

```txt
upsert affected=1 author now="Benjamin C. Pierce" copies kept=7
```

- `DoNothing()` skips conflicting rows instead.
- MySQL fires on any unique key (engine rule); `OnConflict` is ignored there.
- Auto-generated PKs are **not** written back into the entities — this is a set-based statement; reload if you need the keys.
- `autoCreate`/`autoUpdate` timestamps are stamped; the version column is bumped on the update path.

## Raw SQL

Two escape hatches, both with strict column matching — a mismatch is a `*sorm.ScanError` listing missing/extra columns, never silently skipped fields.

`Raw` scans into entities via their metadata:

```go
soon, err := sorm.Raw[models.Loan](db,
    `SELECT * FROM loans WHERE returned_at IS NULL AND due_at < ?`,
    time.Now().AddDate(0, 0, 10)).All(ctx)
```

`RawAs` scans into any struct — aggregates, CTEs, window functions. Mapping is by `sorm:"col"` tag or snake_case of the field name:

```go
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

::: info
Raw SQL is your text: placeholders follow the connection's dialect (`$1` on PostgreSQL, `?` on MySQL/SQLite), and `InSchema` does not rewrite it.
:::

## Naming queries for observability

`Named("...")` labels a query for instrumentation — spans and metrics carry it as `sorm.query.name` ([Observability](./observability.md)):

```go
sorm.Query[models.Book](db).Named("catalog.recent").Where(...).All(ctx)
```

`sorm.WithQueryName(ctx, "checkout")` attributes every operation under a context; an explicit context name wins over `Named`.
