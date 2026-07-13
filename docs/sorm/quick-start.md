# Quick Start

This walkthrough builds a small library-lending system from scratch: define models, generate typed code, create the schema, query, and persist changes through the unit of work. Every snippet below comes from a compiled, executed program (SQLite, pure Go driver).

## 1. Create the project

```sh
mkdir library && cd library
go mod init library
go get github.com/dvislobokov/sorm
```

## 2. Define models

Models are plain Go structs in their own package. Exactly one field carries the `sorm:"pk"` tag — that is what marks a struct as an entity.

```go
// models/models.go
package models

import "time"

type Member struct {
    ID       int64     `sorm:"pk,auto"`
    Email    string    `sorm:"unique"`
    Name     string
    JoinedAt time.Time `sorm:"autoCreate"`
    Version  int64     `sorm:"version"`

    Loans []*Loan      `sorm:"hasMany:MemberID"`
    Card  *LibraryCard `sorm:"hasOne:MemberID"`
}

type LibraryCard struct {
    ID       int64     `sorm:"pk,auto"`
    MemberID int64     `sorm:"fk:Member.ID,uniqueIndex:uq_library_cards_member"`
    Number   string    `sorm:"unique"`
    IssuedAt time.Time `sorm:"autoCreate"`
}

type Book struct {
    ID      int64  `sorm:"pk,auto"`
    ISBN    string `sorm:"unique"`
    Title   string `sorm:"index:idx_books_title"`
    Author  string
    Year    int
    Copies  int
    Version int64 `sorm:"version"`

    Loans  []*Loan  `sorm:"hasMany:BookID"`
    Genres []*Genre `sorm:"many2many:book_genres"`
}

type Genre struct {
    ID   int64  `sorm:"pk,auto"`
    Name string `sorm:"unique"`

    Books []*Book `sorm:"many2many:book_genres"`
}

type Loan struct {
    ID         int64     `sorm:"pk,auto"`
    BookID     int64     `sorm:"fk:Book.ID,index:idx_loans_book_member"`
    MemberID   int64     `sorm:"fk:Member.ID,index:idx_loans_book_member"`
    BorrowedAt time.Time `sorm:"autoCreate"`
    DueAt      time.Time
    ReturnedAt *time.Time
    UpdatedAt  time.Time `sorm:"autoUpdate"`

    Book   *Book   `sorm:"belongsTo:BookID"`
    Member *Member `sorm:"belongsTo:MemberID"`
}
```

See [Models](./models.md) for the complete tag reference.

## 3. Generate the typed package

```sh
go get github.com/dvislobokov/sorm/cmd/sorm
go run github.com/dvislobokov/sorm/cmd/sorm gen ./models
```

```txt
sorm: generated 7 file(s) for 5 entit(ies) in models\sormgen
```

The `models/sormgen` package now contains column descriptors (`sormgen.Book.Title`), relation descriptors, entity metadata, table definitions for migrations, and a `Context` type — the unit-of-work facade. Details in [Code Generation](./codegen.md).

## 4. Connect and create the schema

::: code-group

```go [sqlite]
import (
    "database/sql"
    _ "modernc.org/sqlite"

    "github.com/dvislobokov/sorm/dialect/lite"
    "github.com/dvislobokov/sorm/driver/sqld"
    "github.com/dvislobokov/sorm/migrate"

    _ "library/models/sormgen" // registers models with the runtime
)

sdb, err := sql.Open("sqlite", "file:library.db")
if err != nil { ... }
if err := migrate.Apply(ctx, sdb, "sqlite"); err != nil { ... }
db := sqld.Wrap(sdb, lite.Dialect{})
```

```go [postgres]
import (
    "github.com/jackc/pgx/v5/pgxpool"
    "database/sql"
    _ "github.com/jackc/pgx/v5/stdlib"

    "github.com/dvislobokov/sorm/driver/pgxd"
    "github.com/dvislobokov/sorm/migrate"

    _ "library/models/sormgen"
)

sdb, _ := sql.Open("pgx", dsn)                  // database/sql handle for migrations
if err := migrate.Apply(ctx, sdb, "postgres"); err != nil { ... }

pool, err := pgxpool.New(ctx, dsn)              // pgx pool for the runtime
if err != nil { ... }
db := pgxd.Wrap(pool)
```

```go [mysql]
import (
    "database/sql"
    _ "github.com/go-sql-driver/mysql"

    "github.com/dvislobokov/sorm/dialect/my"
    "github.com/dvislobokov/sorm/driver/sqld"
    "github.com/dvislobokov/sorm/migrate"

    _ "library/models/sormgen"
)

sdb, err := sql.Open("mysql", dsn+"?parseTime=true")
if err != nil { ... }
if err := migrate.Apply(ctx, sdb, "mysql"); err != nil { ... }
db := sqld.Wrap(sdb, my.Dialect{})
```

:::

`migrate.Apply` diffs the live database against the registered models and applies exactly the missing DDL — see [Migrations](./migrations.md). `migrate.Plan` returns the same statements without executing them. Real output on an empty SQLite database:

```txt
CREATE TABLE `books` (`id` integer NOT NULL PRIMARY KEY AUTOINCREMENT, `isbn` text NOT NULL, `title` text NOT NULL, `author` text NOT NULL, `year` integer NOT NULL, `copies` integer NOT NULL, `version` integer NOT NULL)
CREATE UNIQUE INDEX `books_isbn_key` ON `books` (`isbn`)
CREATE INDEX `idx_books_title` ON `books` (`title`)
CREATE TABLE `loans` (`id` integer NOT NULL PRIMARY KEY AUTOINCREMENT, `book_id` integer NOT NULL, `member_id` integer NOT NULL, `borrowed_at` datetime NOT NULL, `due_at` datetime NOT NULL, `returned_at` datetime NULL, `updated_at` datetime NOT NULL, CONSTRAINT `loans_book_id_fkey` FOREIGN KEY (`book_id`) REFERENCES `books` (`id`), CONSTRAINT `loans_member_id_fkey` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`))
...
```

## 5. Insert an object graph

`sormgen.NewContext` starts a unit of work. New entities are registered with `Add`; foreign keys inside a new graph are wired through navigations — the runtime inserts parents first and fills the FK columns in.

```go
c := sormgen.NewContext(db)

ada  := &models.Member{Email: "ada@library.dev", Name: "Ada Lovelace"}
gopl := &models.Book{ISBN: "978-0134190440", Title: "The Go Programming Language",
    Author: "Donovan & Kernighan", Year: 2015, Copies: 2}
c.Members.Add(ada)
c.Books.Add(gopl)

loan := &models.Loan{DueAt: time.Now().AddDate(0, 0, 14)}
loan.Book = gopl    // navigation, not a raw FK value
loan.Member = ada
c.Loans.Add(loan)

err := c.SaveChanges(ctx)
```

```txt
ada.ID=1 gopl.ID=2 loan.ID=1 loan.BookID=2 loan.MemberID=1
autoCreate stamped: joined=true borrowed=true
```

Auto-generated primary keys are written back into the structs, FK fixup happened automatically, and the `autoCreate` timestamps were stamped.

## 6. Query

```go
b := sormgen.Book

recent, err := sorm.Query[models.Book](db).
    Where(b.Year.Gte(1990), b.Copies.Gt(0)).
    OrderBy(b.Year.Desc(), b.Title.Asc()).
    Limit(10).
    All(ctx)

one, err := sorm.Query[models.Book](db).Where(b.ISBN.Eq("978-0134190440")).One(ctx)
```

Every builder exposes `ToSQL()` — inspection instead of magic:

```txt
SQL:  SELECT "id", "isbn", "title", "author", "year", "copies", "version" FROM "books" WHERE ("year" >= ? AND "copies" > ?) ORDER BY "year" DESC, "title" LIMIT 10
args: [1990 0]
```

Eager-load relations with `With`:

```go
members, err := sorm.Query[models.Member](db).
    With(
        sormgen.Member.Card.Include(),
        sormgen.Member.Loans.Include(
            sormgen.Loan.ReturnedAt.IsNull(),   // child filter
            sormgen.Loan.DueAt.Asc(),           // child order
            sormgen.Loan.Book.Include(),        // nested include
        ),
    ).
    All(ctx)
```

```txt
Ada Lovelace card=LC-1001 loans=2
  due 2026-07-20: Structure and Interpretation of Computer Programs
  due 2026-07-27: The Go Programming Language
```

## 7. Update through change tracking

```go
c := sormgen.NewContext(db)
book, err := c.Books.Where(b.ISBN.Eq("978-0134190440")).One(ctx)  // tracked
book.Copies = 5                                                    // plain mutation
err = c.SaveChanges(ctx)                                           // minimal diff
```

The only statement executed (captured with `sorm.Instrument`):

```txt
UPDATE "books" SET "copies" = ?, "version" = "version" + 1 WHERE "id" = ? AND "version" = ?
```

The `version` column is incremented and checked — a concurrent modification produces a `*sorm.ConflictError` instead of a lost update. Calling `SaveChanges` again with no changes executes no SQL at all.

## Where next

- [Models](./models.md) — the full struct tag reference.
- [Queries](./queries.md) — predicates, subqueries, streaming, raw SQL.
- [Sessions](./sessions.md) — tracking semantics, transactions, concurrency.
- [Relations](./relations.md) — all four relation kinds and eager loading.
- [Migrations](./migrations.md) — declarative and versioned workflows.
