# Book Catalog

A tiny personal library CRUD app. One Next.js process serves both a REST/JSON
API and a responsive UI — a table layout on desktop, a card + floating-button
layout on the phone. Data lives in a single SQLite file via Prisma.

## Stack

- **Next.js 15** (App Router) — API routes + UI in one process
- **Prisma + SQLite** — `prisma/dev.db`, swap to Postgres by editing `prisma/schema.prisma` + `.env`
- **Tailwind CSS** — responsive desktop / phone layouts
- **PWA manifest** — "Add to Home Screen" on Android for a full-screen app feel

## First-time setup

```bash
npm install
cp .env.example .env      # already present; edit only to change the DB
npm run db:push           # creates prisma/dev.db from the schema
npm run db:seed           # optional: inserts 3 sample books
```

## User access

Set `OWNER_EMAIL`, a random `AUTH_SECRET` (at least 32 characters), and
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` in `.env`.
The configured Owner signs in at `/login` and adds users through **Manage users**.
Only enabled, listed users receive codes. Codes expire in 10 minutes, allow five
attempts, and can be used once. Requests are limited to one per minute and five
per hour per email. Login sessions last 30 days; signing out revokes the session.
Disabling a user revokes their sessions and outstanding codes immediately.

- Owner: manage users, edit catalog and locations, delete books.
- Librarian: scan, add and edit books, manage locations.
- View: search and view books only.

The single Owner is determined by `OWNER_EMAIL`, not an editable user role.
SMTP must be configured; login codes are never printed to logs.
After schema changes, run `node node_modules/prisma/build/index.js db push`
with the development server stopped, then restart it.

## Run it (dev)

```bash
npm run dev
```

Opens on `http://localhost:3000`. The dev server also binds to `0.0.0.0`, so
from your phone on the same Wi-Fi use `http://<desktop-ip>:3000`
(find the IP with `ipconfig` — look for the IPv4 address, e.g. `192.168.1.20`).

## Run it (always-on)

```bash
npm run build
npm start
```

Same URLs. To keep it running after logout / reboot, either:

- create a `.bat` that runs `npm start` in this folder and add it to **Task
  Scheduler** (trigger: *At log on*), or
- `npm i -g pm2 && pm2 start "npm start" --name books && pm2 save` for
  restart-on-crash.

## Windows Firewall

The first time the phone connects, Windows may prompt to allow Node.js on
**private networks** — allow it. If you missed the prompt:
Windows Security → Firewall → Allow an app → add Node.js for Private.

## API

| Method | Path                  | Purpose                                   |
| ------ | --------------------- | ----------------------------------------- |
| GET    | `/api/books?q=`       | list / search                             |
| POST   | `/api/books`          | create                                    |
| GET    | `/api/books/:id`      | fetch one                                 |
| PUT    | `/api/books/:id`      | update                                    |
| DELETE | `/api/books/:id`      | delete                                    |
| GET    | `/api/lookup?isbn=`   | fetch metadata for an ISBN (see below)    |

`q` matches title, author, publisher, tags, and ISBN. `sort` accepts
`title|authors|publicationDate|rating|createdAt|updatedAt`, `dir` accepts
`asc|desc`.

## ISBN barcode scan + auto-fill

On the **Add / Edit** screen:

- **Scan ISBN** opens the camera, reads the EAN-13 barcode on the back cover, then
  looks the book up and fills the empty fields (title, authors, publisher,
  publication date, pages, language, tags, cover image).
- **Look up ISBN** does the same from a typed ISBN — no camera needed.

`/api/lookup` queries **Open Library** first (no key, no quota) and fills any gaps
from **Google Books**. Only empty fields are filled, so your own edits are never
overwritten. Year-only publication dates become `YYYY-01-01`.

### The camera needs HTTPS

Browsers only allow camera access over `https://` or `http://localhost` — **not**
over `http://<lan-ip>`. So for scanning on the phone:

```bash
npm run dev:https
```

Next generates a local certificate; open `https://<desktop-ip>:3000` on the phone
and tap **Advanced → Proceed** past the “not private” warning once. Typed
**Look up ISBN** works fine over plain `http://` if you'd rather skip the cert.

## Fields

title\*, authors, isbn13, isbn10, publisher, publicationDate, edition, language,
pageCount, tags, format (hardcover/paperback/ebook/audiobook/other),
shelfLocation, dateAcquired, price, rating (1–5), coverImageUrl, notes.
Dates are stored as `YYYY-MM-DD` text to keep the form simple.

## Moving to Postgres later

1. `prisma/schema.prisma` → `provider = "postgresql"`
2. `.env` → `DATABASE_URL="postgresql://user:pass@host:5432/books"`
3. `npm run db:push`

No application code changes.

## Moving books between shelves

Owner and Librarian users can open **Move books** from the catalog. Choose a
destination shelf, then enter a collection ID (for example `B000123` or `123`)
and press **Move book**, or use **Scan book ID**. Each successful scan moves the
book immediately and keeps the destination selected for the next book. Recent
results show the title and previous/new location; an unknown ID changes nothing.

Printed library labels now include a QR code containing the permanent book ID.
Reprint older text-only labels to scan them. This identifies the individual copy;
use the library label when moving books. Phone camera scanning requires HTTPS.
A keyboard-style USB/Bluetooth scanner can fill the Book ID field and submit
with Enter. No database migration is required for this feature.

## Classifying the collection

Each book has an optional **Type** (Fiction or Non-fiction) and any number of
**Categories**. Unclassified books are included in the catalog's type/category
filters. Category names are searchable and appear on book cards and in the table.

Owner and Librarian users can open **Classify books** from the catalog:

- Review suggestions from existing tags, or click **Look up ISBN** for fresh
  Open Library/Google Books subjects. Suggestions need explicit acceptance.
- Select up to 100 books and choose a shared type/categories to fill empty fields.
  Existing types and category selections are preserved. Use **Edit** on a book
  to replace or clear an existing classification.
- Use **Manage categories** to add or rename categories. Renaming updates all
  assigned books; duplicate names are rejected regardless of case/spacing.

The Add/Edit form also offers category selections and suggestions after ISBN
lookup. Suggestions never save automatically or overwrite existing selections.
Subjects remain available as tags. Matching uses conservative subject rules;
missing or conflicting metadata should be reviewed manually.

For a fresh installation, stop the server, run `npm run db:push` followed by
`npm run db:categories`, then restart. This creates 18 starter categories without
classifying any books. Existing installations should back up the database first
(for the default SQLite path, `python scripts/backup-classification.py`).

## Backups

The whole database is `prisma/dev.db`. Copy it somewhere safe on a schedule
(`copy prisma\dev.db backups\dev-%date%.db`).

## Book owners

Use **Book owners** on the catalog to add or rename people whose books are in the library. Owner and Librarian accounts can manage this list. Book ownership is separate from login accounts and grants no application access.

Choose a **Book owner** on the Add / Edit book form. Existing books start Unassigned. Owner names appear on desktop and phone lists and are included in catalog search. Duplicate names are rejected regardless of capitalization or extra spaces. Renaming a person updates the displayed name for all associated books.
