# API Reference

Every exported symbol, grouped by package. Signatures are authoritative for `github.com/dvislobokov/sorm` v0.5.0.

## Package sorm

### Errors

```go
var ErrNotFound = errors.New("sorm: not found")
var ErrCyclicGraph = errors.New("sorm: cyclic dependency between new entities")
```

`ErrNotFound` is the single not-found sentinel across the API (`One`, `Find`). `ErrCyclicGraph` reports a cycle between new entities during `SaveChanges`.

```go
type ConflictError struct {
    Table string
    PK    any
}
func (e *ConflictError) Error() string
```

Optimistic concurrency: an UPDATE/DELETE affected 0 rows — the row changed or was deleted after loading.

```go
type ConstraintKind int
const (
    ConstraintUnique ConstraintKind = iota + 1
    ConstraintForeignKey
    ConstraintNotNull
    ConstraintCheck
)

type ConstraintError struct {
    Kind       ConstraintKind
    Constraint string // constraint/column name, if reported
    Err        error
}
func (e *ConstraintError) Error() string
func (e *ConstraintError) Unwrap() error

func IsUniqueViolation(err error) bool
```

A DB constraint violation translated into a typed error by the driver adapter.

```go
type ScanError struct {
    Missing []string // result columns with no destination
    Extra   []string // expected but absent from the result
}
func (e *ScanError) Error() string
```

Column/field mismatch in `Raw`, `RawAs`, or `Project`.

### Connection

```go
type DB interface {
    Dialect() dialect.Dialect
    Query(ctx context.Context, sql string, args ...any) (Rows, error)
    Exec(ctx context.Context, sql string, args ...any) (int64, error)
    ExecBatch(ctx context.Context, items []BatchItem) error
    Begin(ctx context.Context) (Tx, error)
}

type Tx interface {
    DB
    Commit(ctx context.Context) error
    Rollback(ctx context.Context) error
}

type Rows interface {
    Next() bool
    Scan(dest ...any) error
    Err() error
    Close()
    Columns() []string
}

type BatchItem struct {
    SQL     string
    Args    []any
    IDCount int                    // >0: multi-row INSERT with auto-PK
    OnIDs   func(ids []int64)      // receives generated ids in VALUES order
    Check   func(rowsAffected int64) error // optimistic concurrency check
}
```

```go
func RunInTx(ctx context.Context, db DB, fn func(tx Tx) error) error
```

Commit on nil, rollback on error; transient errors (deadlock, serialization failure) retry with exponential backoff, up to 3 retries. `fn` may run multiple times.

```go
func WithReplicas(primary DB, replicas ...DB) DB
func Primary(db DB) DB
func Replica(db DB) DB
func InSchema(db DB, schema string) DB
```

Read/write splitting, per-query routing overrides, and schema-qualified (multi-tenant) connections. See [Databases](./databases.md).

```go
type Op struct {
    Kind       string   // "query" | "exec" | "batch" | "begin" | "commit" | "rollback"
    SQL        string
    Args       []any
    Statements []string // batch only
}
type InstrumentFunc func(ctx context.Context, op Op, next func(ctx context.Context) error) error

func Instrument(db DB, fn InstrumentFunc) DB
```

Middleware over every DB operation. `fn` must call `next` exactly once.

```go
func WithQueryName(ctx context.Context, name string) context.Context
func QueryNameFromContext(ctx context.Context) string
```

### Session and sets

```go
type Session struct{ /* unexported */ }

func NewSession(db DB) *Session
func (s *Session) DB() DB
func (s *Session) SaveChanges(ctx context.Context) error
func (s *Session) SaveChangesTx(ctx context.Context, tx Tx) error

func Track[E any](s *Session) QueryBuilder[E]
func Add[E any](s *Session, entities ...*E)
func Remove[E any](s *Session, entities ...*E)
```

Unit of Work: identity map plus snapshot change tracking. Not thread-safe; lives for one unit of work. `SaveChanges` opens a transaction and applies DELETE (children first) → UPDATE (changed columns only) → INSERT by dependency level with FK fixup.

```go
type Set[E any] struct{ /* unexported */ }

func NewSet[E any](s *Session) Set[E]
func (s Set[E]) Add(entities ...*E)
func (s Set[E]) Remove(entities ...*E)
func (s Set[E]) Find(ctx context.Context, pk any) (*E, error)
func (s Set[E]) Query() QueryBuilder[E]           // tracked
func (s Set[E]) NoTracking() QueryBuilder[E]      // untracked
// query-root shortcuts:
func (s Set[E]) Where(ps ...Pred[E]) QueryBuilder[E]
func (s Set[E]) With(specs ...IncludeSpec[E]) QueryBuilder[E]
func (s Set[E]) OrderBy(os ...Order[E]) QueryBuilder[E]
func (s Set[E]) Limit(n int) QueryBuilder[E]
func (s Set[E]) Named(name string) QueryBuilder[E]
func (s Set[E]) All(ctx context.Context) ([]*E, error)
func (s Set[E]) One(...)  // via Query()
func (s Set[E]) Count(ctx context.Context) (int64, error)
func (s Set[E]) Iter(ctx context.Context) iter.Seq2[*E, error]
```

Typed access to one entity within a unit of work — the `DbSet` analog. Normally created by the generated `NewContext`.

### Query builder

```go
func Query[E any](db DB) QueryBuilder[E]

func (q QueryBuilder[E]) Where(ps ...Pred[E]) QueryBuilder[E]
func (q QueryBuilder[E]) With(specs ...IncludeSpec[E]) QueryBuilder[E]
func (q QueryBuilder[E]) OrderBy(os ...Order[E]) QueryBuilder[E]
func (q QueryBuilder[E]) Limit(n int) QueryBuilder[E]
func (q QueryBuilder[E]) Offset(n int) QueryBuilder[E]
func (q QueryBuilder[E]) ForUpdate() QueryBuilder[E]           // PG/MySQL
func (q QueryBuilder[E]) ForUpdateSkipLocked() QueryBuilder[E] // PG/MySQL 8+
func (q QueryBuilder[E]) WithDeleted() QueryBuilder[E]
func (q QueryBuilder[E]) OnlyDeleted() QueryBuilder[E]
func (q QueryBuilder[E]) Named(name string) QueryBuilder[E]

func (q QueryBuilder[E]) All(ctx context.Context) ([]*E, error)
func (q QueryBuilder[E]) One(ctx context.Context) (*E, error)  // ErrNotFound
func (q QueryBuilder[E]) Count(ctx context.Context) (int64, error)
func (q QueryBuilder[E]) Iter(ctx context.Context) iter.Seq2[*E, error]
func (q QueryBuilder[E]) ToSQL() (string, []any)
```

Immutable builder — every method returns a copy. `Iter` streams and is incompatible with `With`.

### Predicates and logic

```go
type Pred[E any] struct{ /* unexported */ }

func And[E any](ps ...Pred[E]) Pred[E]   // no args: TRUE
func Or[E any](ps ...Pred[E]) Pred[E]    // no args: FALSE
func Not[E any](p Pred[E]) Pred[E]

type Order[E any] struct{ /* unexported */ }
type Assign[E any] struct{ /* unexported */ }
```

### Column descriptors

Constructed by generated code (`NewCol`, `NewOrdCol`, `NewStrCol`, `NewBytesCol`, `NewScalarCol`, `NewArrayCol`, `NewJSONCol` — all take `(table, name)`).

```go
type Col[E any, V comparable] struct{ /* unexported */ }
// Eq, Neq, In, NotIn, IsNull, IsNotNull, Asc, Desc, Set, SetNull, ColName

type OrdCol[E any, V comparable] struct{ Col[E, V] }
// + Gt, Gte, Lt, Lte, Between

type StrCol[E any] struct{ OrdCol[E, string] }
// + Like, ILike, Contains, HasPrefix, HasSuffix (literals escaped)

type BytesCol[E any] struct{ /* unexported */ }
// Eq, Neq, IsNull, IsNotNull, Set, SetNull

type ScalarCol[E any, V any] struct{ /* unexported */ }
// Eq, Neq, In, NotIn, Gt, Gte, Lt, Lte, IsNull, IsNotNull, Asc, Desc, Set, SetNull

type ArrayCol[E any, V comparable] struct{ /* unexported */ }   // PostgreSQL only
// Has(v), Contains(vs...), Overlaps(vs...), IsNull, IsNotNull, Set, SetNull
```

Column interfaces (accepted by projections, aggregates, joins):

```go
type AnyCol interface{ ColName() string /* ... */ }       // any entity's column
type ColOf[E any] interface{ AnyCol /* ... */ }           // column of exactly E
type ColV[V comparable] interface{ AnyCol /* ... */ }     // column with value type V
type ColOfV[E any, V comparable] interface{ ColOf[E] /* ... */ }
```

### JSON columns

```go
type JSONCol[E any] struct{ /* unexported */ }
func (c JSONCol[E]) Path(path string) JSONPath[E]   // dot notation "a.b.c"
func (c JSONCol[E]) HasKey(key string) Pred[E]
func (c JSONCol[E]) Contains(v any) Pred[E]         // PG @>, MySQL JSON_CONTAINS; error on SQLite
func (c JSONCol[E]) IsNull() Pred[E]
func (c JSONCol[E]) IsNotNull() Pred[E]
func (c JSONCol[E]) Set(v any) Assign[E]            // marshaled
func (c JSONCol[E]) SetNull() Assign[E]

type JSONPath[E any] struct{ /* unexported */ }
// Eq, Neq, In, IsNull (absent or JSON null), IsNotNull — string comparisons

// Typed accessors generated for struct documents:
type JSONStr[E any] struct{ /* Eq, Neq, In, Like, IsNull, IsNotNull */ }
type JSONNum[E any, V int64 | float64] struct{ /* Eq..Lte, IsNull, IsNotNull */ }
type JSONBool[E any] struct{ /* Eq, IsTrue, IsFalse, IsNull, IsNotNull */ }
type JSONArr[E any] struct{ /* Contains (PG/MySQL), IsNull, IsNotNull */ }
// constructors: NewJSONStr/NewJSONNum/NewJSONBool/NewJSONArr(table, col, path)
```

JSON helper functions (used by generated code, available for custom work):

```go
func JSONValue(v any) driver.Valuer     // marshal on write; nil-ish -> SQL NULL
func JSONScan[T any](dst *T) sql.Scanner // unmarshal on read; NULL -> zero value
func JSONSnapshot(v any) []byte          // deterministic snapshot for diffing
```

### Relations

Constructed by generated code:

```go
func NewHasMany[E, C any](fkCol string, parentKey func(*E) any, childKey func(*C) any,
    initSlice func(*E), appendChild func(*E, *C)) HasMany[E, C]
func NewBelongsTo[C, P any](fkCol string, childFK func(*C) any, setParent func(*C, *P)) BelongsTo[C, P]
func NewHasOne[E, C any](fkCol string, parentKey func(*E) any, childKey func(*C) any,
    setChild func(*E, *C)) HasOne[E, C]
func NewManyToMany[E, C any](joinTable, parentCol, childCol string,
    initSlice func(*E), appendChild func(*E, *C)) ManyToMany[E, C]
```

```go
type HasMany[E, C any]
func (r HasMany[E, C]) Include(opts ...ChildOpt[C]) IncludeSpec[E]
func (r HasMany[E, C]) Any(preds ...Pred[C]) Pred[E]    // EXISTS
func (r HasMany[E, C]) None(preds ...Pred[C]) Pred[E]   // NOT EXISTS
func (r HasMany[E, C]) LeftJoin(preds ...Pred[C]) JoinSpec[E]
func (r HasMany[E, C]) InnerJoin(preds ...Pred[C]) JoinSpec[E]

type BelongsTo[C, P any]
func (r BelongsTo[C, P]) Include(opts ...ChildOpt[P]) IncludeSpec[C]
func (r BelongsTo[C, P]) Is(preds ...Pred[P]) Pred[C]

type HasOne[E, C any]
func (r HasOne[E, C]) Include(opts ...ChildOpt[C]) IncludeSpec[E]
func (r HasOne[E, C]) Any(preds ...Pred[C]) Pred[E]
func (r HasOne[E, C]) None(preds ...Pred[C]) Pred[E]

type ManyToMany[E, C any]
func (r ManyToMany[E, C]) Include(opts ...ChildOpt[C]) IncludeSpec[E]
func (r ManyToMany[E, C]) Any(preds ...Pred[C]) Pred[E]
func (r ManyToMany[E, C]) Link(ctx context.Context, db DB, parent *E, children ...*C) error
func (r ManyToMany[E, C]) Unlink(ctx context.Context, db DB, parent *E, children ...*C) error

type IncludeSpec[E any] struct{ /* unexported */ }
type ChildOpt[C any] interface{ /* Pred[C] | Order[C] | IncludeSpec[C] */ }
```

### Projections and aggregates

```go
func From[E any](db DB) FromBuilder[E]
func (q FromBuilder[E]) Where(ps ...Pred[E]) FromBuilder[E]
func (q FromBuilder[E]) Join(specs ...JoinSpec[E]) FromBuilder[E]
func (q FromBuilder[E]) GroupBy(cols ...ColOf[E]) FromBuilder[E]
func (q FromBuilder[E]) Having(ps ...Pred[E]) FromBuilder[E]
func (q FromBuilder[E]) OrderBy(os ...Order[E]) FromBuilder[E]
func (q FromBuilder[E]) Limit(n int) FromBuilder[E]
func (q FromBuilder[E]) Offset(n int) FromBuilder[E]
func (q FromBuilder[E]) WithDeleted() FromBuilder[E]
func (q FromBuilder[E]) Named(name string) FromBuilder[E]

func Project[R any, E any](q FromBuilder[E], exprs ...SelectExpr[E]) ProjQuery[R]
func (q ProjQuery[R]) All(ctx context.Context) ([]*R, error)
func (q ProjQuery[R]) One(ctx context.Context) (*R, error)
func (q ProjQuery[R]) ToSQL() (string, []any, error)
```

Select expressions:

```go
func Field[E any](c ColOf[E]) SelectExpr[E]
func FieldAs[E any](c ColOf[E], alias string) SelectExpr[E]
func FieldOf[E any](c AnyCol) SelectExpr[E]
func FieldOfAs[E any](c AnyCol, alias string) SelectExpr[E]
func As[E any, V comparable](a AggExpr[E, V], alias string) SelectExpr[E]
```

Aggregates:

```go
func CountAll[E any]() AggExpr[E, int64]
func Count[E any](c AnyCol) AggExpr[E, int64]
func CountDistinct[E any](c AnyCol) AggExpr[E, int64]
func Sum[E any, V comparable](c ColV[V]) AggExpr[E, V]
func Avg[E any](c AnyCol) AggExpr[E, float64]
func Min[E any, V comparable](c ColV[V]) AggExpr[E, V]
func Max[E any, V comparable](c ColV[V]) AggExpr[E, V]

// AggExpr comparisons yield Having predicates:
func (a AggExpr[E, V]) Eq(v V) Pred[E]   // also Gt, Gte, Lt, Lte
```

Custom aggregate assembly:

```go
func NewAgg[E any, V comparable](parts ...AggPart) AggExpr[E, V]
func AggRaw(sql string) AggPart       // raw fragment
func AggCol(c AnyCol) AggPart         // column reference
func AggArg(v any) AggPart            // bind parameter
func AggLit(s string) AggPart         // quoted literal
func AggDialect(name string) AggPart  // dialect guard
```

Joins:

```go
func ColEq[C, E any, V comparable](joined ColOfV[C, V], existing ColOfV[E, V]) JoinOn[C, E]
func LeftJoinOn[C, E any](on JoinOn[C, E], preds ...Pred[C]) JoinSpec[E]
func InnerJoinOn[C, E any](on JoinOn[C, E], preds ...Pred[C]) JoinSpec[E]
func CrossJoin[C, E any]() JoinSpec[E]
```

### Subqueries

```go
type SubQ[V comparable] struct{ /* unexported */ }

func Pick[E any, V comparable](c ColOfV[E, V], q QueryBuilder[E]) SubQ[V]        // column subquery
func PickScalar[E any, V comparable](a AggExpr[E, V], q QueryBuilder[E]) SubQ[V] // scalar aggregate

func InQuery[E any, V comparable](c ColOfV[E, V], sub SubQ[V]) Pred[E]
func NotInQuery[E any, V comparable](c ColOfV[E, V], sub SubQ[V]) Pred[E]
func EqQ[E any, V comparable](c ColOfV[E, V], sub SubQ[V]) Pred[E]   // also NeqQ, GtQ, GteQ, LtQ, LteQ
```

Build the inner query with a `nil` db — rendering follows the outer query's dialect.

### Set-based statements

```go
func Update[E any](db DB) UpdateBuilder[E]
// Set(as ...Assign[E]), Where, AllRows, WithDeleted, Named, ToSQL, Exec -> (int64, error)

func Delete[E any](db DB) DeleteBuilder[E]
// Where, AllRows, Hard (bypass soft delete), Named, ToSQL, Exec -> (int64, error)

func Upsert[E any](db DB) UpsertBuilder[E]
// Rows(es ...*E), OnConflict(cols ...ColOf[E]), DoUpdate(cols ...ColOf[E]),
// DoNothing(), Named, ToSQL, Exec -> (int64, error)
```

`Update`/`Delete` without `Where` require `AllRows()`. Version columns are bumped automatically. Upsert does not write generated PKs back.

### Raw SQL

```go
func Raw[E any](db DB, sql string, args ...any) RawQuery[E]    // scan into entities via meta
func RawAs[R any](db DB, sql string, args ...any) RawQuery[R]  // scan into any struct
func (q RawQuery[T]) All(ctx context.Context) ([]*T, error)
func (q RawQuery[T]) One(ctx context.Context) (*T, error)
func (q RawQuery[T]) Named(name string) RawQuery[T]
```

Strict column matching; mismatches return `*ScanError`.

### Hooks

```go
type SaveOp int
const (
    SaveInsert SaveOp = iota
    SaveUpdate
    SaveDelete
)
func (o SaveOp) String() string

type BeforeSaver interface {
    BeforeSave(ctx context.Context, op SaveOp) error
}
type AfterLoader interface {
    AfterLoad(ctx context.Context) error
}
```

Detected by interface assertion on model types. Set-based statements bypass hooks.

### Metadata and schema registry

```go
type Meta[E any] struct {
    Table, PK, VersionCol, SoftDeleteCol string
    Auto                                 bool
    SelectCols, InsertCols               []string
    Scan         func(*E) []any
    InsertValues func(*E) []any
    ValuesFor    func(*E, []int) []any
    Snapshot     func(*E) any
    Diff         func(any, *E) []int
    SetPK        func(*E, int64)
    PKValue      func(*E) any
    GetVersion   func(*E) int64
    SetVersion   func(*E, int64)
    SetDeleted   func(*E, time.Time)
    TouchCreate  func(*E, time.Time)
    TouchUpdate  func(*E, time.Time)
    Refs         []Ref[E]
    RefTables    []string
}

func Register[E any](m Meta[E])
func MetaOf[E any]() *Meta[E]   // panics if unregistered

type Ref[E any] struct {
    FKCol    string
    NotNull  bool
    Nav      func(*E) any
    NavPK    func(*E) any
    SetFK    func(*E, any)
    FKIsZero func(*E) bool
}
```

```go
type TableDef struct {
    Name    string
    Columns []ColumnDef
    Indexes []IndexDef
}
type ColumnDef struct {
    Name, GoKind, SQLType, RefTable, RefCol string
    Nullable, Unique, PK, Auto              bool
}
type IndexDef struct {
    Name    string
    Columns []string
    Parts   []IndexPart
    Unique  bool
    Type    string // "gin"/"brin" (PG), "fulltext" (MySQL)
    Where   string // partial index condition (PG, SQLite)
}
type IndexPart struct {
    Column string
    Expr   string
    Desc   bool
}
func (ix IndexDef) IndexParts() []IndexPart

func RegisterTable(def TableDef)
func UnregisterTable(name string)
func Tables() []TableDef
func SQLTypeFor(dialect string, c ColumnDef) string
```

### Utilities

```go
func ClonePtr[V any](p *V) *V
func CloneTimePtr(p *time.Time) *time.Time
func PtrEq[V comparable](a, b *V) bool
func TimePtrEq(a, b *time.Time) bool
func ScalarSnapshot(v driver.Valuer) any
```

Snapshot helpers used by generated code.

## Package dialect

```go
type Dialect interface {
    Name() string               // "postgres", "mysql", "sqlite"
    Placeholder(n int) string   // $1 or ?
    QuoteIdent(s string) string
    ReturningSupported() bool
}
```

Implementations: `dialect/pg.Dialect{}`, `dialect/my.Dialect{}`, `dialect/lite.Dialect{}`.

## Package driver/pgxd

```go
type Pgx interface {
    Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
    Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
    SendBatch(ctx context.Context, b *pgx.Batch) pgx.BatchResults
}

func Wrap(p Pgx) sorm.DB
```

pgx v5 adapter (PostgreSQL); wraps `*pgxpool.Pool`, `*pgx.Conn`, or `pgx.Tx`. One roundtrip per write batch.

## Package driver/sqld

```go
func Wrap(sdb *sql.DB, d dialect.Dialect) sorm.DB
```

`database/sql` adapter (MySQL, SQLite). Batches execute sequentially; auto-PKs via `RETURNING` where supported, else `LastInsertId`.

## Package migrate

```go
const HistoryTable = "sorm_migrations"
const SumFile = "sorm.sum"

func Apply(ctx context.Context, db *sql.DB, dialect string, opts ...Option) error
func Plan(ctx context.Context, db *sql.DB, dialect string, opts ...Option) ([]string, error)
func Diff(ctx context.Context, dev *sql.DB, dialect, dir, name string) (string, error)
func Up(ctx context.Context, db *sql.DB, dialect, dir string) ([]string, error)
func Down(ctx context.Context, db *sql.DB, dialect, dir string, steps int) ([]string, error)
func Pending(ctx context.Context, db *sql.DB, dialect, dir string) ([]string, error)

func Seed(ctx context.Context, db *sql.DB, dialect, name string,
    fn func(ctx context.Context, tx *sql.Tx) error) error
func SeedApplied(ctx context.Context, db *sql.DB, dialect, name string) (bool, error)

func VerifySum(dir string) error
func WriteSum(dir string) error
func SplitStatements(content string) []string

type Option func(*config)
func WithSchema(name string) Option

type SumError struct {
    Modified, Missing, Extra []string
}
func (e *SumError) Error() string
```

See [Migrations](./migrations.md).

## Package pgagg (PostgreSQL aggregates)

```go
func StringAgg[E any](c sorm.AnyCol, sep string) sorm.AggExpr[E, string]
func ArrayAgg[E any](c sorm.AnyCol) sorm.AggExpr[E, string]
func JSONBAgg[E any](c sorm.AnyCol) sorm.AggExpr[E, string]
func JSONBObjectAgg[E any](k, v sorm.AnyCol) sorm.AggExpr[E, string]
func BoolAnd[E any](c sorm.AnyCol) sorm.AggExpr[E, bool]
func BoolOr[E any](c sorm.AnyCol) sorm.AggExpr[E, bool]
func BitAnd[E any](c sorm.AnyCol) sorm.AggExpr[E, int64]
func BitOr[E any](c sorm.AnyCol) sorm.AggExpr[E, int64]
func PercentileCont[E any](fraction float64, orderBy sorm.AnyCol) sorm.AggExpr[E, float64]
func PercentileDisc[E any](fraction float64, orderBy sorm.AnyCol) sorm.AggExpr[E, float64]
func Mode[E any](orderBy sorm.AnyCol) sorm.AggExpr[E, string]
func StdDev[E any](c sorm.AnyCol) sorm.AggExpr[E, float64]      // also StdDevPop, StdDevSamp
func Variance[E any](c sorm.AnyCol) sorm.AggExpr[E, float64]    // also VarPop, VarSamp
func Corr[E any](y, x sorm.AnyCol) sorm.AggExpr[E, float64]
func CovarPop[E any](y, x sorm.AnyCol) sorm.AggExpr[E, float64] // also CovarSamp
```

## Package myagg (MySQL aggregates)

```go
func GroupConcat[E any](c sorm.AnyCol) sorm.AggExpr[E, string]
func GroupConcatSep[E any](c sorm.AnyCol, sep string) sorm.AggExpr[E, string]
func GroupConcatDistinct[E any](c sorm.AnyCol, sep string) sorm.AggExpr[E, string]
func JSONArrayAgg[E any](c sorm.AnyCol) sorm.AggExpr[E, string]
func JSONObjectAgg[E any](k, v sorm.AnyCol) sorm.AggExpr[E, string]
func AnyValue[E any, V comparable](c sorm.ColV[V]) sorm.AggExpr[E, V]
func BitAnd[E any](c sorm.AnyCol) sorm.AggExpr[E, int64]        // also BitOr, BitXor
func StdDev[E any](c sorm.AnyCol) sorm.AggExpr[E, float64]      // also StdDevPop, StdDevSamp
func VarPop[E any](c sorm.AnyCol) sorm.AggExpr[E, float64]      // also VarSamp
```

## Package otelsorm

```go
func Wrap(db sorm.DB, opts ...Option) sorm.DB

type Option func(*config)
func WithTracerProvider(tp trace.TracerProvider) Option
func WithMeterProvider(mp metric.MeterProvider) Option
func WithArgs() Option
func WithoutTableAttr() Option
func WithDBStats(sdb *sql.DB) Option
func WithPoolStats(fn func() PoolStats) Option

type PoolStats struct {
    Max, Idle, Used, WaitCount int64
    WaitDuration               time.Duration
}
```

Tracing and metrics on top of `sorm.Instrument`. See [Observability](./observability.md#opentelemetry-otelsorm) for the metric list.

## Package sormtest

```go
func AssertSQL(t testing.TB, q any, wantSQL string, wantArgs ...any)
func NewSQLite(t testing.TB) sorm.DB
func NewPostgres(t testing.TB) sorm.DB   // requires SORM_TEST_DSN; per-test schema
func Load(t testing.TB, db sorm.DB, paths ...string)   // YAML fixtures, FK-ordered

func CountQueries(db sorm.DB) (sorm.DB, *Counter)
type Counter struct{ /* unexported */ }
func (c *Counter) Selects() int64
func (c *Counter) Writes() int64
func (c *Counter) Total() int64
func (c *Counter) Reset()
```

## Command sorm (cmd/sorm)

```txt
sorm gen [-naming snake|camel|pascal] [models dir]
sorm schema -dialect postgres|mysql|sqlite [-out schema.sql] [-naming ...] [models dir]
sorm migrate diff [-dialect postgres] [-dir migrations] [-dev-dsn DSN] [-naming ...] <name> [models dir]
sorm migrate up -dsn DSN [-dialect postgres] [-dir migrations]
```

Run with `go run github.com/dvislobokov/sorm/cmd/sorm ...`. See [Code Generation](./codegen.md) and [Migrations](./migrations.md).
