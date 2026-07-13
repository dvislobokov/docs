# Projections and Aggregates

When you need shapes other than whole entities — report rows, aggregates, joined columns — start with `sorm.From[E]` and project into an arbitrary struct with `sorm.Project`. Column-to-field matching is validated strictly before the query runs.

## Projecting into a struct

```go
type memberStat struct {
    MemberID int64 `sorm:"member_id"`
    Loans    int64 `sorm:"loans"`
}

l := sormgen.Loan

stats, err := sorm.Project[memberStat](
    sorm.From[models.Loan](db).GroupBy(l.MemberID),
    sorm.Field(l.MemberID),                       // root column, name = column name
    sorm.As(sorm.CountAll[models.Loan](), "loans"), // aggregate with alias
).All(ctx)
```

Result fields map by `sorm:"col"` tag or snake_case of the field name. A mismatch between the SELECT list and the struct is a `*sorm.ScanError` listing the missing/extra columns — never silently dropped fields. Terminal methods: `All`, `One`, `ToSQL`.

### Select expressions

| Function | Use |
|---|---|
| `Field(col)` | column of the root entity; result name = column name |
| `FieldAs(col, alias)` | root column with an alias (e.g. name collisions after a JOIN) |
| `FieldOf[E](col)` | column of a **joined** entity ("relaxed mode": table membership checked at build time) |
| `FieldOfAs[E](col, alias)` | same, with alias |
| `As(agg, alias)` | aggregate expression with alias |

## Aggregates

Portable aggregates in the core package:

```go
sorm.CountAll[models.Loan]()          // count(*)
sorm.Count[models.Loan](l.BookID)     // count(col)
sorm.CountDistinct[models.Loan](l.BookID)
sorm.Sum[models.Book, int](b.Copies)
sorm.Avg[models.Book](b.Copies)       // float64
sorm.Min[models.Book, int](b.Year)
sorm.Max[models.Book, int](b.Year)
```

`AggExpr[E, V]` is typed over its value `V`; its comparisons (`Eq`, `Gt`, `Gte`, `Lt`, `Lte`) yield predicates valid only in `Having`.

## GROUP BY and HAVING

```go
stats, err := sorm.Project[memberStat](
    sorm.From[models.Loan](db).
        GroupBy(l.MemberID).
        Having(sorm.CountAll[models.Loan]().Gte(2)),
    sorm.Field(l.MemberID),
    sorm.As(sorm.CountAll[models.Loan](), "loans"),
).All(ctx)
```

`FromBuilder` also supports `Where`, `OrderBy`, `Limit`, `Offset`, `Named`, and `WithDeleted` (disables the root table's soft-delete filter; joined tables are never filtered implicitly).

## Joins

Verified example — loans joined to books and members:

```go
b, m := sormgen.Book, sormgen.Member

type loanRow struct {
    Title string `sorm:"title"`
    Name  string `sorm:"name"`
}

rows, err := sorm.Project[loanRow](
    sorm.From[models.Loan](db).
        Join(
            sorm.InnerJoinOn(sorm.ColEq(b.ID, l.BookID)),
            sorm.InnerJoinOn(sorm.ColEq(m.ID, l.MemberID)),
        ),
    sorm.FieldOf[models.Loan](b.Title),
    sorm.FieldOf[models.Loan](m.Name),
).All(ctx)
```

```txt
"Structure and Interpretation of Computer Programs" -> Ada Lovelace
"The Go Programming Language" -> Ada Lovelace
```

`ColEq(joined, existing)` type-checks that both columns share a value type. Join sources:

- relation methods: `b.Loans.LeftJoin(preds...)`, `b.Loans.InnerJoin(preds...)` — join over the relation's FK, predicates go into `ON`;
- free functions: `LeftJoinOn`, `InnerJoinOn`, `CrossJoin`.

Aggregating over a joined column works the same way (verified):

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

## Dialect-specific aggregates

Engine-specific functions live in dedicated packages. Using them on the wrong dialect is a **build error returned when the query executes** — never silently wrong SQL.

::: code-group

```go [postgres (pgagg)]
import "github.com/dvislobokov/sorm/pgagg"

rows, err := sorm.Project[stat](
    sorm.From[models.User](db).GroupBy(u.Country),
    sorm.Field(u.Country),
    sorm.As(pgagg.StringAgg[models.User](u.Name, ", "), "names"),
    sorm.As(pgagg.PercentileCont[models.User](0.5, u.Age), "median_age"),
).All(ctx)
```

```go [mysql (myagg)]
import "github.com/dvislobokov/sorm/myagg"

rows, err := sorm.Project[stat](
    sorm.From[models.User](db).GroupBy(u.Country),
    sorm.Field(u.Country),
    sorm.As(myagg.GroupConcatSep[models.User](u.Name, ", "), "names"),
    sorm.As(myagg.AnyValue[models.User, string](u.Capital), "capital"),
).All(ctx)
```

:::

Highlights:

- **pgagg**: `StringAgg`, `ArrayAgg`, `JSONBAgg`, `JSONBObjectAgg`, `BoolAnd`/`BoolOr`, `BitAnd`/`BitOr`, `PercentileCont`/`PercentileDisc`, `Mode`, `StdDev*`, `Var*`, `Corr`, `CovarPop`/`CovarSamp`.
- **myagg**: `GroupConcat`/`GroupConcatSep`/`GroupConcatDistinct`, `JSONArrayAgg`, `JSONObjectAgg`, `AnyValue` (for `ONLY_FULL_GROUP_BY`), `BitAnd`/`BitOr`/`BitXor`, `StdDev*`, `Var*`.

## Custom aggregate expressions

Anything not covered ships as parts via `NewAgg` — this is exactly how `pgagg`/`myagg` are built:

```go
// max(books.year) assembled by hand (verified on SQLite)
sorm.NewAgg[models.Loan, int64](
    sorm.AggRaw("max("), sorm.AggCol(b.Year), sorm.AggRaw(")"))

// string_agg(name, ', ') guarded to PostgreSQL
sorm.NewAgg[models.User, string](
    sorm.AggDialect("postgres"),
    sorm.AggRaw("string_agg("), sorm.AggCol(u.Name), sorm.AggRaw(", "),
    sorm.AggArg(", "), sorm.AggRaw(")"),
)
```

| Part | Emits |
|---|---|
| `AggRaw(sql)` | raw SQL fragment verbatim |
| `AggCol(col)` | a column reference (qualified inside projections) |
| `AggArg(v)` | a bind-parameter placeholder |
| `AggLit(s)` | a safely quoted string literal (where the grammar forbids placeholders) |
| `AggDialect(name)` | guard: rendering on any other dialect fails at execution |

::: tip
For result shapes beyond projections — CTEs, window functions — drop to [`RawAs`](./queries.md#raw-sql), which scans into any struct with the same strict matching.
:::
