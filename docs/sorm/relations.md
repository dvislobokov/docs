# Relations

sorm supports four relation kinds — `hasMany`, `belongsTo`, `hasOne`, and `many2many` — declared with tags on navigation fields and materialized as typed descriptors by the generator. Eager loading uses the split strategy: one additional query per include, distributed to parents in memory; no row-multiplying JOINs.

## Declaring relations

```go
type Member struct {
    ID    int64        `sorm:"pk,auto"`
    Loans []*Loan      `sorm:"hasMany:MemberID"`      // 1:N — FK on Loan
    Card  *LibraryCard `sorm:"hasOne:MemberID"`       // 1:1 — FK on LibraryCard
}

type Loan struct {
    ID       int64   `sorm:"pk,auto"`
    BookID   int64   `sorm:"fk:Book.ID"`
    MemberID int64   `sorm:"fk:Member.ID"`
    Book     *Book   `sorm:"belongsTo:BookID"`        // N:1 — FK on this struct
    Member   *Member `sorm:"belongsTo:MemberID"`
}

type Book struct {
    ID     int64    `sorm:"pk,auto"`
    Genres []*Genre `sorm:"many2many:book_genres"`    // N:M via join table
}
```

| Kind | Field type | Tag value | FK lives on |
|---|---|---|---|
| `hasMany` | `[]*Child` | Go name of the FK field on the child | child |
| `belongsTo` | `*Parent` | Go name of the FK field on this struct | this struct |
| `hasOne` | `*Child` | Go name of the FK field on the child | child (usually with `uniqueIndex`) |
| `many2many` | `[]*Other` | join table name | implicit join table |

The `fk:Entity.Field` tag on the FK column produces the actual DB constraint and the dependency edges used for write ordering. The `many2many` join table is generated automatically (two FK columns, composite PK) and registered for migrations.

## Eager loading with With / Include

`Include()` on a relation descriptor produces an `IncludeSpec`; feed specs to `QueryBuilder.With`:

```go
m, l := sormgen.Member, sormgen.Loan

members, err := sorm.Query[models.Member](db).
    With(
        m.Card.Include(),                       // hasOne
        m.Loans.Include(                        // hasMany with options:
            l.ReturnedAt.IsNull(),              //   child filter (Pred[Loan])
            l.DueAt.Asc(),                      //   child ordering (Order[Loan])
            l.Book.Include(),                   //   nested include (ThenInclude analog)
        ),
    ).
    OrderBy(m.ID.Asc()).
    All(ctx)
```

Verified output:

```txt
Ada Lovelace card=LC-1001 loans=2
  due 2026-07-20: Structure and Interpretation of Computer Programs
  due 2026-07-27: The Go Programming Language
Grace Hopper card=LC-1002 loans=0
```

`Include` options are `ChildOpt`s: any mix of child predicates, child orderings, and nested `IncludeSpec`s. Nesting works on every kind — a `belongsTo` include can load the parent's relations, and so on.

Loading semantics per kind:

- **hasMany** — one query `WHERE fk IN (parent pks)` (chunked), children appended per parent. After an include, an empty slice means "loaded, none matched"; `nil` means "not loaded".
- **belongsTo** — one query `WHERE pk IN (children's fks)`. Predicate options filter the parents; a child whose parent is filtered out keeps a `nil` navigation.
- **hasOne** — like hasMany but a single child pointer. A missing child is indistinguishable from "not loaded" (both `nil`).
- **many2many** — join-table pairs plus one `IN` query for the children, distributed to parents; `Order[C]` options order children within each parent.

```go
b, g := sormgen.Book, sormgen.Genre

books, err := sorm.Query[models.Book](db).
    With(b.Genres.Include(g.Name.Asc())).
    All(ctx)
```

```txt
Structure and Interpretation of Computer Programs -> [Computer Science]
The Go Programming Language -> [Computer Science Programming]
Types and Programming Languages -> [Computer Science]
```

::: warning
Eager loading requires the full parent set, so `With` is incompatible with `Iter` streaming.
:::

## Filtering by relations

Relation descriptors also build predicates on the **root** entity, rendered as correlated `EXISTS` subqueries — no JOIN, no duplicate rows:

```go
// members with at least one open loan
sorm.Query[models.Member](db).Where(m.Loans.Any(l.ReturnedAt.IsNull()))

// members with no loans at all
sorm.Query[models.Member](db).Where(m.Loans.None())

// loans whose book is by Pierce (child filtered by parent)
sorm.Query[models.Loan](db).Where(l.Book.Is(b.Author.HasPrefix("Pierce")))

// books tagged "Programming" (through the join table)
sorm.Query[models.Book](db).Where(b.Genres.Any(g.Name.Eq("Programming")))
```

| Method | On | Meaning |
|---|---|---|
| `Any(preds...)` | hasMany / hasOne / many2many | `EXISTS (...)` — at least one related row matches |
| `None(preds...)` | hasMany / hasOne | `NOT EXISTS (...)` |
| `Is(preds...)` | belongsTo | parent matches: `EXISTS (SELECT 1 FROM parents WHERE pk = fk AND ...)` |

## Joins from relations

For projections, `hasMany` descriptors emit typed JOIN specs; arbitrary joins use `ColEq`:

```go
// LEFT JOIN loans ON loans.book_id = books.id AND loans.returned_at IS NULL
sorm.From[models.Book](db).Join(b.Loans.LeftJoin(l.ReturnedAt.IsNull()))

// arbitrary join with a type-checked ON condition
sorm.From[models.Loan](db).Join(
    sorm.InnerJoinOn(sorm.ColEq(b.ID, l.BookID)),
)
```

See [Projections](./projections.md#joins) for consuming joined columns.

## many2many: Link and Unlink

sorm does not guess collection diffs for many-to-many — linking is an explicit operation on the descriptor:

```go
err := sormgen.Book.Genres.Link(ctx, db, gopl, csGenre, progGenre)  // INSERT into book_genres
err  = sormgen.Book.Genres.Unlink(ctx, db, gopl, progGenre)         // DELETE from book_genres
```

Both sides must already be persisted. Linking the same pair twice violates the join table's composite primary key:

```txt
double link -> unique violation: true
```

```go
if sorm.IsUniqueViolation(err) { /* already linked */ }
```

## New graphs and write ordering

Navigations drive inserts, not just reads. Assign the parent object to a new child's navigation and `SaveChanges` handles ordering and FK fixup:

```go
loan := &models.Loan{DueAt: due}
loan.Book = book       // book may itself be new
loan.Member = member
c.Loans.Add(loan)
err := c.SaveChanges(ctx)   // parents first, then loan with FKs filled in
```

Deletes flow the other way — children before parents — within the same flush. Details in [Sessions](./sessions.md#what-savechanges-does).
