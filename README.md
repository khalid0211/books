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

## Backups

The whole database is `prisma/dev.db`. Copy it somewhere safe on a schedule
(`copy prisma\dev.db backups\dev-%date%.db`).
