# Observability and Testing

sorm exposes a single instrumentation seam — `sorm.Instrument` — and builds everything else on top of it: logging, OpenTelemetry tracing and metrics (`otelsorm`), and the query counters in the testing toolkit (`sormtest`). Errors are typed, so handlers and dashboards can classify failures without parsing driver codes.

## Instrument: the middleware seam

`Instrument` wraps a `sorm.DB` with a function that sees every operation — queries, execs, batches, and transaction begin/commit/rollback. It works with any adapter, and transactions started from the wrapped connection are instrumented with the same function.

```go
db = sorm.Instrument(db, func(ctx context.Context, op sorm.Op, next func(context.Context) error) error {
    start := time.Now()
    err := next(ctx)
    slog.Info("sql", "kind", op.Kind, "sql", op.SQL, "dur", time.Since(start), "err", err)
    return err
})
```

`op.Kind` is one of `query`, `exec`, `batch`, `begin`, `commit`, `rollback`; for batches, `op.Statements` carries every statement. The function must call `next` exactly once.

This is how the SaveChanges SQL in these docs was captured:

```txt
[sql] UPDATE "books" SET "copies" = ?, "version" = "version" + 1 WHERE "id" = ? AND "version" = ?
```

### Naming queries

Attach logical names so telemetry aggregates by operation, not by SQL text:

```go
sorm.Query[models.Book](db).Named("catalog.recent")...    // builder-level
ctx = sorm.WithQueryName(ctx, "checkout")                  // context-level (wins over Named)
```

`QueryNameFromContext(ctx)` reads the name back inside instrumentation.

## OpenTelemetry: otelsorm

```go
import "github.com/dvislobokov/sorm/otelsorm"

db = otelsorm.Wrap(db)
```

Every database operation becomes a client span, and these metrics are recorded (all carry `db.system`, `db.operation.name`, `sorm.query.name` when set, and best-effort `db.collection.name`):

| Instrument | Type | Meaning |
|---|---|---|
| `db.client.operation.duration` | histogram (s) | semconv-compatible latency |
| `sorm.db.batch.size` | histogram | statements per write batch |
| `sorm.db.statements` | counter | by `db.statement.kind` (insert/update/delete/select) |
| `sorm.db.errors` | counter | by `error.type` (conflict, constraint.unique, transient, ...) |
| `sorm.db.rows.returned` | histogram | rows fetched per query |
| `sorm.tx.duration` | histogram (s) | begin to commit/rollback, by outcome |
| `sorm.tx.retries` | counter | `RunInTx` transient-error retries |
| `sorm.pool.*` | gauges | optional, via `WithDBStats`/`WithPoolStats` |

SQL text never goes into metric attributes (unbounded cardinality) — it stays on spans. The sorm core does not depend on OpenTelemetry; the dependency links only when `otelsorm` is imported.

Options:

```go
db = otelsorm.Wrap(db,
    otelsorm.WithTracerProvider(tp),
    otelsorm.WithMeterProvider(mp),
    otelsorm.WithArgs(),           // record query args on spans (off by default: sensitive)
    otelsorm.WithoutTableAttr(),   // drop db.collection.name
    otelsorm.WithDBStats(sdb),     // pool gauges from database/sql
    otelsorm.WithPoolStats(func() otelsorm.PoolStats {  // pool gauges from pgxpool
        s := pool.Stat()
        return otelsorm.PoolStats{
            Max: int64(s.MaxConns()), Idle: int64(s.IdleConns()),
            Used: int64(s.AcquiredConns()),
            WaitCount: s.EmptyAcquireCount(), WaitDuration: s.AcquireDuration(),
        }
    }),
)
```

Recommended wrapper order: instrumentation outside, `InSchema` in the middle, the replica resolver inside.

## Typed errors

| Error | When | Classify with |
|---|---|---|
| `sorm.ErrNotFound` | `One`/`Find` matched nothing | `errors.Is` |
| `*sorm.ConflictError` | optimistic concurrency: UPDATE/DELETE hit 0 rows | `errors.As` |
| `*sorm.ConstraintError` | unique/FK/not-null/check violation, translated by the adapter | `errors.As` + `.Kind` |
| `*sorm.ScanError` | Raw/RawAs/Project column mismatch (`Missing`/`Extra` lists) | `errors.As` |
| `sorm.ErrCyclicGraph` | cycle between new entities in one flush | `errors.Is` |

```go
var ce *sorm.ConstraintError
if errors.As(err, &ce) && ce.Kind == sorm.ConstraintUnique {
    return echo.NewHTTPError(http.StatusConflict, "email already taken")
}
if sorm.IsUniqueViolation(err) { ... }   // shorthand
```

Verified classification against SQLite:

```txt
double link -> unique violation: true
second save -> ConflictError: true | sorm: concurrency conflict on books pk=2 (row changed or deleted since load)
```

## Testing with sormtest

`sormtest` supports a test pyramid without mocking `sorm.DB` (you would be testing the mock, not your queries):

1. **Query construction** — `AssertSQL`, no database at all.
2. **Data-access code** — `NewSQLite`: in-memory database with the real schema of your registered models.
3. **Dialect-specific code** — `NewPostgres`: one shared PostgreSQL, an isolated schema per test.
4. **Business logic** — mock your own repository interfaces; sorm is not involved.

### AssertSQL

Renders any builder with a `ToSQL` method and compares the SQL exactly (args compared when given):

```go
func TestRecentBooksQuery(t *testing.T) {
    q := sorm.Query[models.Book](nil).Where(gen.Book.Year.Gte(1990)).OrderBy(gen.Book.Year.Desc())
    sormtest.AssertSQL(t, q,
        `SELECT "id", "isbn", "title", "author", "year", "copies", "version" FROM "books" WHERE "year" >= $1 ORDER BY "year" DESC`,
        1990)
}
```

### NewSQLite and NewPostgres

```go
func TestCheckout(t *testing.T) {
    db := sormtest.NewSQLite(t)   // in-memory, schema applied, closed via t.Cleanup
    // ...
}
```

`NewSQLite` is millisecond-fast and safe under `t.Parallel()` — every call is a private database. PostgreSQL-only features (arrays, `pgagg`, `ForUpdate`) fail with explicit errors; move those tests to `NewPostgres`, which binds each test to a fresh schema in the server pointed to by `SORM_TEST_DSN` (skipped when unset) and drops it afterwards.

### Fixtures

`Load` seeds YAML fixtures; tables insert parents-first based on the FK graph of the registered `TableDef`s, regardless of file order:

```yaml
members:
  - {id: 1, email: ada@library.dev, name: Ada, joined_at: 2026-01-01T00:00:00Z, version: 1}
loans:
  - {id: 1, book_id: 1, member_id: 1, borrowed_at: 2026-01-02T00:00:00Z,
     due_at: 2026-01-16T00:00:00Z, updated_at: 2026-01-02T00:00:00Z}
```

```go
sormtest.Load(t, db, "testdata/library.yaml")
```

Rows are raw: every NOT NULL column must be present — fixtures bypass auto-timestamps and hooks by design.

### Query budgets and N+1

```go
db, queries := sormtest.CountQueries(sormtest.NewSQLite(t))
// ... load a page with includes ...
if queries.Selects() > 3 {
    t.Fatalf("N+1: %d selects for one page", queries.Selects())
}
```

`Counter` exposes `Selects()`, `Writes()` (execs plus every batch item), `Total()`, and `Reset()` (e.g. after seeding).
