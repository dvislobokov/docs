# Sessions and Change Tracking

A `sorm.Session` is the Unit of Work: an identity map plus snapshot change tracking. Entities loaded through the session are mutated with plain Go code; `SaveChanges` computes the minimal diff and applies it in ordered batches within a single transaction. The generated `Context` wraps a session with one typed `Set` per entity.

## Lifecycle

```go
c := sormgen.NewContext(db)   // Session + typed sets
// ... one request / one unit of work ...
err := c.SaveChanges(ctx)
```

A session is **not thread-safe** (like EF Core's `DbContext`) and is meant to live for one unit of work — one HTTP request, one job, one transaction. Create it, use it, discard it. Sessions always run on the primary connection when read replicas are configured (read-your-writes).

Without generated code, the raw primitives are `sorm.NewSession(db)`, `sorm.Track[E](s)`, `sorm.Add[E](s, ...)`, `sorm.Remove[E](s, ...)` — the `Context`/`Set` API below is the same machinery with types wired up.

## Reading: tracked and untracked

Queries started from a set are tracked — materialized entities land in the identity map and are snapshotted:

```go
book, err := c.Books.Where(gen.Book.ISBN.Eq("978-0134190440")).One(ctx)
books, err := c.Books.OrderBy(gen.Book.Title.Asc()).All(ctx)
n, err := c.Books.Count(ctx)
```

`Find` follows EF semantics — the identity map first, no SQL if the entity is already tracked:

```go
book, err := c.Books.Find(ctx, 42)   // ErrNotFound if the row does not exist
```

Identity-map guarantees:

- Reloading the same row returns the **already-tracked pointer**.
- Database data never overwrites local changes on a tracked entity.

For large read-only result sets, skip tracking:

```go
list, err := c.Books.NoTracking().Where(...).All(ctx)   // no snapshots, no identity map
```

`sorm.Query[E](db)` outside a session is always untracked.

## Inserting

```go
ada := &models.Member{Email: "ada@library.dev", Name: "Ada Lovelace"}
c.Members.Add(ada)

loan := &models.Loan{DueAt: due}
loan.Book = gopl      // set navigations, not FK values
loan.Member = ada
c.Loans.Add(loan)

err := c.SaveChanges(ctx)
// ada.ID, loan.ID, loan.BookID, loan.MemberID are now populated
```

New graphs are wired through navigations. `SaveChanges` inserts by dependency level (topological order over the `belongsTo` edges), obtains generated keys (`RETURNING` on PostgreSQL, `LastInsertId` on MySQL/SQLite), and fixes up child FK columns before inserting them. A cycle between new entities yields `sorm.ErrCyclicGraph`.

Verified output:

```txt
ada.ID=1 gopl.ID=2 loan.ID=1 loan.BookID=2 loan.MemberID=1
autoCreate stamped: joined=true borrowed=true
```

## Updating

No `Update` call exists — mutate tracked entities and save:

```go
book, _ := c.Books.Find(ctx, id)
book.Copies = 5
err := c.SaveChanges(ctx)
```

`SaveChanges` diffs each tracked entity against its load-time snapshot and updates **only the changed columns**:

```txt
UPDATE "books" SET "copies" = ?, "version" = "version" + 1 WHERE "id" = ? AND "version" = ?
```

A `SaveChanges` with no changes executes no SQL.

## Deleting

```go
loans, _ := c.Loans.Where(gen.Loan.MemberID.Eq(ada.ID)).All(ctx)
c.Loans.Remove(loans...)
err := c.SaveChanges(ctx)
```

An entity passed to `Remove` must be tracked or have a populated PK. For entities with a `softDelete` field, `Remove` becomes an UPDATE stamping the timestamp.

## What SaveChanges does

`SaveChanges` opens a transaction, applies the plan, and commits:

1. **BeforeSave hooks** run during planning, before any SQL is built — an error aborts the flush entirely.
2. **DELETE** — children before parents (FK order), batched with the UPDATEs.
3. **UPDATE** — changed columns only, version checks appended.
4. **INSERT** — by dependency level; each level is one batch; generated keys flow into children's FKs.

On PostgreSQL the DELETE+UPDATE batch and each insert level go over the wire as a single `pgx.Batch` roundtrip. Auto-timestamps stamped in one flush all share a single `time.Now()`.

Tracker state (snapshots, identity map) is updated after a successful flush — the session remains usable.

## Transactions

### RunInTx

The generated context wraps `sorm.RunInTx`:

```go
err := c.RunInTx(ctx, func(txc *sormgen.Context) error {
    book, err := txc.Books.Find(ctx, id)
    if err != nil {
        return err
    }
    book.Copies--
    loan := &models.Loan{DueAt: due, Book: book, Member: member}
    txc.Loans.Add(loan)
    return txc.SaveChanges(ctx)  // flushes inside this transaction
})
```

- Commit on `nil`, rollback on error.
- Transient failures (deadlock, serialization) are retried with exponential backoff, up to 3 retries — `fn` may run multiple times, so side effects outside the database must be idempotent.
- Each attempt gets a **fresh child context** bound to the transaction. Work only through `txc` inside the closure; do not mix in the parent context's state.

Verified rollback behavior:

```txt
commit err: <nil>
rollback err: business rule: negative stock
copies after rollback: 2
```

### External transactions

`SaveChangesTx(ctx, tx)` applies the diff inside a transaction you manage; commit is up to you. A session constructed over an open `Tx` (`NewSession(tx)` / `NewContext(tx)`) flushes within it without opening a nested one.

## Optimistic concurrency

Give an entity a `Version int64` field tagged `sorm:"version"`. Every session UPDATE/DELETE then carries `AND version = ?`; zero affected rows means the row changed or vanished after loading:

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
    // reload, merge, retry — or surface HTTP 409
}
```

Set-based `Update` builders increment the version too, so they cooperate with open sessions instead of hiding behind them.

## Typed errors

| Error | Meaning |
|---|---|
| `sorm.ErrNotFound` | `One`/`Find` matched nothing — the single not-found sentinel across the API |
| `*sorm.ConflictError` | optimistic concurrency: 0 rows affected (`Table`, `PK` fields) |
| `*sorm.ConstraintError` | DB constraint violation, translated by the driver adapter: `Kind` is `ConstraintUnique`, `ConstraintForeignKey`, `ConstraintNotNull`, or `ConstraintCheck` |
| `sorm.ErrCyclicGraph` | a dependency cycle between new entities in one flush |

```go
var ce *sorm.ConstraintError
if errors.As(err, &ce) && ce.Kind == sorm.ConstraintUnique {
    // "email already taken" -> 409, without parsing driver codes
}
// shorthand:
if sorm.IsUniqueViolation(err) { ... }
```
