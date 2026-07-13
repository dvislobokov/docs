# Models

Entities are plain Go structs in a dedicated models package. A struct becomes an entity when exactly one field carries the `sorm:"pk"` tag; everything else is derived from field types and tags by the `sorm gen` parser.

## Anatomy of an entity

```go
type Book struct {
    ID      int64  `sorm:"pk,auto"`            // primary key, DB-generated
    ISBN    string `sorm:"unique"`             // unique constraint
    Title   string `sorm:"index:idx_books_title"`
    Author  string                             // plain column: title -> "author"
    Year    int
    Copies  int
    Version int64 `sorm:"version"`             // optimistic concurrency

    Loans  []*Loan  `sorm:"hasMany:BookID"`    // navigation, not a column
    Genres []*Genre `sorm:"many2many:book_genres"`
}
```

Unexported fields are ignored. Exported struct-typed fields that point at another entity **must** carry a relation tag (or `sorm:"-"`) — the parser reports an error otherwise.

## Tag reference

All options live in the single `sorm:"..."` tag, comma-separated. Flags and `key:value` options can be mixed: `sorm:"pk,auto"`, `sorm:"fk:Member.ID,index:idx_loans_member"`.

| Tag | Applies to | Meaning |
|---|---|---|
| `pk` | one field per entity | Primary key. Composite primary keys are not supported. |
| `auto` | integer `pk` | DB-generated key (identity/autoincrement). The value is written back after INSERT (`RETURNING` on PostgreSQL, `LastInsertId` on MySQL/SQLite). Only integer types. |
| `unique` | any column | Unique constraint on the column. |
| `version` | plain `int64` | Optimistic concurrency token. Incremented on every UPDATE; checked in UPDATE/DELETE `WHERE`. Must be a non-pointer `int64`; one per entity. |
| `autoCreate` | plain `time.Time` | Stamped on INSERT when zero — a manually set value wins. |
| `autoUpdate` | plain `time.Time` | Stamped on INSERT and on every effective UPDATE. Combining with `autoCreate` on one field is rejected as redundant. |
| `softDelete` | `*time.Time` | Soft deletion. Queries implicitly filter `IS NULL`; session `Remove` and set-based `Delete` become UPDATEs stamping the field. Cannot be combined with `pk`/`version`/auto-timestamps. One per entity. |
| `col:name` | any column | Explicit column name (overrides the naming strategy). |
| `table:name` | any field | Explicit table name for the whole entity. |
| `type:SQLTYPE` | any column | SQL type override, e.g. `type:numeric(20,8)`. Required for custom scalar types. |
| `fk:Entity.Field` | FK column | Declares a foreign key targeting another entity's field; produces a DB-level FK constraint and feeds relation wiring. |
| `index` / `index:name` | any column | Secondary index. Fields sharing the same `index:name` form a composite index in declaration order. Without a name: `idx_<table>_<col>`. |
| `uniqueIndex` / `uniqueIndex:name` | any column | Same, but unique. Mixing `index` and `uniqueIndex` under one name is an error. |
| `json` | struct, map, or slice field | Stores the value as a JSON column (JSONB/JSON/TEXT). See [JSON columns](#json-columns). |
| `array` | `[]string`, `[]int64`, `[]int32`, `[]int`, `[]float64`, `[]bool` | Native PostgreSQL array column. Other dialects reject it at DDL/migration time. |
| `hasMany:FKField` | `[]*Child` | One-to-many navigation; `FKField` is the Go field name of the FK **on the child**. |
| `belongsTo:FKField` | `*Parent` | Many-to-one navigation; `FKField` is the FK field **on this struct**. |
| `hasOne:FKField` | `*Child` | One-to-one navigation; FK lives on the child. |
| `many2many:join_table` | `[]*Other` | Many-to-many through an implicit join table. Must be a slice. |
| `-` | any field | Field is neither a column nor a navigation. |

## Supported field types

| Go type | Column kind | Generated descriptor | Predicates |
|---|---|---|---|
| `bool` | equality | `Col[E, bool]` | `Eq`, `Neq`, `In`, `NotIn` |
| `string` | string | `StrCol[E]` | ordered + `Like`, `ILike`, `Contains`, `HasPrefix`, `HasSuffix` |
| named string type | ordered | `OrdCol[E, T]` | ordered comparisons, no LIKE — but type-safe |
| `int*`, `uint*`, `float*` | ordered | `OrdCol[E, T]` | `Eq`, `Gt`, `Gte`, `Lt`, `Lte`, `Between`, `In`, ... |
| `time.Time` | ordered | `OrdCol[E, time.Time]` | ordered comparisons |
| `[]byte` | bytes | `BytesCol[E]` | `Eq`, `Neq`, `IsNull`, `IsNotNull` (nullable by nature) |
| `uuid.UUID` (`github.com/google/uuid`) | equality | `Col[E, uuid.UUID]` | equality; generate client-side with `uuid.New()` — `auto` does not apply |
| `*T` of any of the above | same, nullable | same descriptor + `IsNull`/`IsNotNull` | predicates take the base type, not pointers |
| struct/map/slice + `json` tag | JSON | `JSONCol[E]` (+ typed doc accessors) | `Path`, `HasKey`, `Contains` |
| `[]T` + `array` tag | PG array | `ArrayCol[E, T]` | `Has`, `Contains`, `Overlaps` |
| named type with `Value()`/`Scan()` | custom scalar | `ScalarCol[E, T]` | full ordered set; comparison happens in SQL |

::: warning Not supported
`sql.NullString` and friends are rejected — use a pointer (`*string`) instead. `*[]byte` is rejected (`[]byte` is already nullable), as is a pointer to a `Valuer`/`Scanner` type (handle NULL inside the type, e.g. `decimal.NullDecimal`).
:::

## Naming

Table and column names are derived from Go names by the naming strategy passed to the generator (`-naming snake|camel|pascal`, default `snake`). Table names pluralize the last word. Explicit `col:`/`table:` overrides always win.

| Go name | snake (default) | camel | pascal |
|---|---|---|---|
| field `CreatedAt` | `created_at` | `createdAt` | `CreatedAt` |
| field `UserID` | `user_id` | `userId` | `UserId` |
| type `ApiKey` | table `api_keys` | `apiKeys` | `ApiKeys` |
| type `LibraryCard` | table `library_cards` | `libraryCards` | `LibraryCards` |

Acronyms are handled (`ISBN` → `isbn`), and pluralization knows the common English rules (`Category` → `categories`, `Box` → `boxes`).

## Nullable columns

A pointer field maps to a nullable column, but predicates stay on the base type — no pointer juggling:

```go
type Loan struct {
    // ...
    ReturnedAt *time.Time  // nullable column
}

open := sorm.Query[models.Loan](db).
    Where(gen.Loan.ReturnedAt.IsNull()).       // open loans
    All(ctx)
```

`Eq(0)` and `Eq(false)` are full-fledged conditions — predicates have no notion of a "zero value".

## Version fields

A `Version int64` field tagged `sorm:"version"` enables optimistic concurrency for the entity. The runtime initializes it on INSERT, increments it on every UPDATE, and appends `AND version = ?` to session UPDATEs and DELETEs. A concurrent change is reported as `*sorm.ConflictError`. Set-based `Update` builders bump the version automatically so open sessions still detect conflicts. See [Sessions](./sessions.md#optimistic-concurrency).

## Soft delete

```go
type User struct {
    ID        int64      `sorm:"pk,auto"`
    DeletedAt *time.Time `sorm:"softDelete"`
}
```

With a `softDelete` field: every query filters `deleted_at IS NULL` implicitly, session `Remove` and the `Delete` builder become UPDATEs stamping the field. Escape hatches: `WithDeleted()` (see all rows), `OnlyDeleted()` (trash-bin view), and `Delete[...](db).Hard()` for a real purge.

## JSON columns

Any marshalable field tagged `sorm:"json"` becomes a JSON column:

```go
type Profile struct {
    ID    int64          `sorm:"pk,auto"`
    Prefs *Prefs         `sorm:"json"` // nullable (pointer)
    Meta  map[string]any `sorm:"json"` // nullable (nil map ⇒ NULL)
}

type Prefs struct {
    Theme string `json:"theme"`
    Limit int    `json:"limit"`
    Beta  bool   `json:"beta"`
}
```

- Maps and slices are inherently nullable (`nil` ⇒ SQL NULL); non-pointer structs stay NOT NULL.
- For struct-typed documents the generator emits **typed accessors** (`gen.Profile.PrefsDoc.Theme.Eq("dark")`) for string/int/float/bool/array/object fields, up to 3 levels deep; anything else stays reachable through `Path("a.b.c")`.
- `[]byte` cannot be a JSON column (ambiguous with the bytes kind).
- Dialect support: `Path` and `HasKey` work everywhere; `Contains` is PostgreSQL (`@>`) and MySQL (`JSON_CONTAINS`) — building it on SQLite returns an error at execution.

## PostgreSQL arrays

```go
type Article struct {
    ID   int64    `sorm:"pk,auto"`
    Tags []string `sorm:"array"`   // text[] on PostgreSQL
}

hits, err := sorm.Query[models.Article](db).
    Where(gen.Article.Tags.Overlaps("go", "sql")).  // tags && ARRAY['go','sql']
    All(ctx)
```

Element types: `string`, `int64`, `int32`, `int`, `float64`, `bool`. A nil slice maps to NULL. Array predicates (`Has`, `Contains`, `Overlaps`) are PostgreSQL-only and fail explicitly on other dialects.

## Custom scalars

A named type implementing `driver.Valuer` (value receiver) and `sql.Scanner` (pointer receiver) — money types, `decimal.Decimal`, encrypted strings — is a column too. The SQL type cannot be inferred, so `type:` is required:

```go
type Price struct { /* ... */ }
func (p Price) Value() (driver.Value, error) { ... }
func (p *Price) Scan(src any) error          { ... }

type Order struct {
    ID    int64 `sorm:"pk,auto"`
    Total Price `sorm:"type:numeric(20,8)"`
}
```

The generated `ScalarCol` has the full ordered predicate set — comparisons run in SQL where the real column type is ordered, so the Go type does not have to be comparable. Custom scalars cannot be `pk`, `version`, or `fk` columns.

## Custom indexes

Simple and composite indexes come from tags. For expression, partial, ordered, or engine-specific indexes, add an `Indexes()` method to the model — `sorm gen` merges it into the table definition:

```go
func (Book) Indexes() []sorm.IndexDef {
    return []sorm.IndexDef{
        {Name: "idx_books_title_fts", Type: "gin",
         Parts: []sorm.IndexPart{{Expr: "to_tsvector('english', title)"}}},
        {Name: "idx_books_recent",
         Parts: []sorm.IndexPart{{Column: "year", Desc: true}},
         Where: "copies > 0"},
    }
}
```

::: warning CLI limitation
The `sorm schema` / `sorm migrate diff` CLI does not execute model code, so it cannot see `Indexes()` methods (it prints a warning). For the full schema use `migrate.Apply`/`Diff` from Go code, which imports your `sormgen` package.
:::

## Lifecycle hooks

Entities may implement two optional interfaces — detected with a plain interface assertion, no registration:

```go
func (l *Loan) BeforeSave(ctx context.Context, op sorm.SaveOp) error {
    if op == sorm.SaveInsert && l.DueAt.Before(time.Now()) {
        return errors.New("due date in the past")  // vetoes the whole flush
    }
    return nil
}

func (b *Book) AfterLoad(ctx context.Context) error {
    // computed fields, decryption, ...
    return nil
}
```

- `BeforeSave` fires during `SaveChanges` planning, before any SQL is built — for every insert and delete, and for updates only when the entity actually changed. Hook mutations are persisted; hooks run before auto-timestamps and version init.
- `AfterLoad` fires for every materialized row (`All`, `One`, `Iter`, `Raw`/`RawAs`).
- Set-based `Update`/`Delete`/`Upsert` builders **bypass** hooks — the same rule as EF Core's `ExecuteUpdate`.
