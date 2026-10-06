import { createHash } from "node:crypto";
import { authorize, OWNER } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Fields = Record<string, string | null>;
type Row = { sourceId: string; fields: Fields };
const api = "https://api.airtable.com/v0";
const delay = () => new Promise(r => setTimeout(r, 220));
const value = (v: unknown) => v == null ? null : v instanceof Date ? v.toISOString() : String(v);
const row = (prefix: string, id: number, fields: Fields): Row => ({ sourceId: prefix + ":" + id, fields: { "Source ID": prefix + ":" + id, ...fields } });
const hash = (fields: Fields) => createHash("sha256").update(JSON.stringify(Object.entries(fields).sort())).digest("hex");
const batches = <T,>(items: T[]) => Array.from({ length: Math.ceil(items.length / 10) }, (_, i) => items.slice(i * 10, i * 10 + 10));

async function request<T>(token: string, url: string, init?: RequestInit, retry = 0): Promise<T> {
  const response = await fetch(url, { ...init, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, cache: "no-store" });
  if (response.status === 429 && retry < 2) { await new Promise(r => setTimeout(r, 30000)); return request<T>(token, url, init, retry + 1); }
  const body = await response.json().catch(() => ({})) as { error?: { message?: string; type?: string } };
  if (!response.ok) throw new Error(body.error?.message || body.error?.type || "Airtable request failed (" + response.status + ").");
  return body as T;
}

async function sync(token: string, baseId: string, table: string, rows: Row[]) {
  const existing = new Map<string, { id: string; hash: string }>();
  let offset = "";
  do {
    const q = new URLSearchParams({ pageSize: "100" });
    q.append("fields[]", "Source ID"); q.append("fields[]", "Sync Hash"); if (offset) q.set("offset", offset);
    const page = await request<{ records: Array<{ id: string; fields?: Record<string, unknown> }>; offset?: string }>(token, api + "/" + encodeURIComponent(baseId) + "/" + encodeURIComponent(table) + "?" + q);
    for (const record of page.records) {
      const id = typeof record.fields?.["Source ID"] === "string" ? record.fields["Source ID"] : "";
      const h = typeof record.fields?.["Sync Hash"] === "string" ? record.fields["Sync Hash"] : "";
      if (id) {
        if (existing.has(id)) throw new Error(table + " contains duplicate Source ID " + id + ".");
        existing.set(id, { id: record.id, hash: h });
      }
    }
    offset = page.offset || ""; if (offset) await delay();
  } while (offset);

  const created: Array<{ fields: Fields }> = [], updated: Array<{ id: string; fields: Fields }> = []; let skipped = 0;
  const now = new Date().toISOString();
  for (const item of rows) {
    const h = hash(item.fields), old = existing.get(item.sourceId);
    if (old?.hash === h) { skipped++; continue; }
    const fields = { ...item.fields, "Sync Hash": h, "Last Synced At": now };
    if (old) updated.push({ id: old.id, fields }); else created.push({ fields: Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null)) });
  }
  const endpoint = api + "/" + encodeURIComponent(baseId) + "/" + encodeURIComponent(table);
  for (const records of batches(created)) { await request(token, endpoint, { method: "POST", body: JSON.stringify({ records }) }); await delay(); }
  for (const records of batches(updated)) { await request(token, endpoint, { method: "PATCH", body: JSON.stringify({ records }) }); await delay(); }
  return { table, created: created.length, updated: updated.length, skipped };
}

export async function POST(req: Request) {
  const denied = await authorize(req, OWNER); if (denied) return denied;
  try {
    const token = process.env.AIRTABLE_TOKEN?.trim(), baseId = process.env.AIRTABLE_BASE_ID?.trim();
    if (!token || !baseId) throw new Error("Airtable is not configured. Add AIRTABLE_TOKEN and AIRTABLE_BASE_ID in Coolify.");
    const [books, owners, categories, rooms, cabinets, shelves, users, loans] = await Promise.all([
      prisma.book.findMany({ include: { owner: true, categories: { orderBy: { name: "asc" } } }, orderBy: { id: "asc" } }),
      prisma.bookOwner.findMany({ orderBy: { id: "asc" } }), prisma.category.findMany({ orderBy: { id: "asc" } }),
      prisma.room.findMany({ orderBy: { id: "asc" } }), prisma.cabinet.findMany({ include: { room: true }, orderBy: { id: "asc" } }),
      prisma.shelf.findMany({ include: { cabinet: { include: { room: true } } }, orderBy: { id: "asc" } }),
      prisma.user.findMany({ orderBy: { id: "asc" } }), prisma.loan.findMany({ include: { book: true, borrower: true }, orderBy: { id: "asc" } })
    ]);
    const data: Array<[string, Row[]]> = [
      ["Books", books.map(b => row("Book", b.id, { "Book Number": value(b.id), Title: value(b.title), Authors: value(b.authors), "ISBN-10": value(b.isbn10), "ISBN-13": value(b.isbn13), Publisher: value(b.publisher), "Publication Date": value(b.publicationDate), Edition: value(b.edition), Language: value(b.language), "Page Count": value(b.pageCount), Tags: value(b.tags), Format: value(b.format), "Book Type": value(b.bookType), "Shelf Location": value(b.shelfLocation), "Date Acquired": value(b.dateAcquired), Price: value(b.price), Rating: value(b.rating), "Cover Image URL": value(b.coverImageUrl), Notes: value(b.notes), "Owner Source ID": b.owner ? "Owner:" + b.owner.id : null, "Owner Name": value(b.owner?.name), Categories: value(b.categories.map(c => c.name).join(", ")), "Created At": value(b.createdAt), "Updated At": value(b.updatedAt) }))],
      ["Book Owners", owners.map(o => row("Owner", o.id, { "Owner Number": value(o.id), Name: value(o.name), "Name Key": value(o.nameKey) }))],
      ["Categories", categories.map(c => row("Category", c.id, { "Category Number": value(c.id), Name: value(c.name), "Name Key": value(c.nameKey) }))],
      ["Rooms", rooms.map(r => row("Room", r.id, { "Room Number": value(r.id), Name: value(r.name), Code: value(r.code) }))],
      ["Cabinets", cabinets.map(c => row("Cabinet", c.id, { "Cabinet Number": value(c.number), "Room Source ID": "Room:" + c.roomId, "Room Name": value(c.room.name) }))],
      ["Shelves", shelves.map(s => row("Shelf", s.id, { "Shelf Number": value(s.number), "Cabinet Source ID": "Cabinet:" + s.cabinetId, "Cabinet Number": value(s.cabinet.number), "Room Source ID": "Room:" + s.cabinet.roomId, "Room Name": value(s.cabinet.room.name) }))],
      ["Users", users.map(u => row("User", u.id, { "User Number": value(u.id), Email: value(u.email), Role: value(u.role), Active: u.active ? "Yes" : "No", "Created At": value(u.createdAt) }))],
      ["Loans", loans.map(l => row("Loan", l.id, { "Loan Number": value(l.id), "Book Source ID": "Book:" + l.bookId, "Book Title": value(l.book.title), "Borrower Source ID": "User:" + l.borrowerId, "Borrower Email": value(l.borrower.email), "Borrowed At": value(l.borrowedAt), "Due At": value(l.dueAt), "Returned At": value(l.returnedAt), "Reminder Attempt At": value(l.reminderAttemptAt), "Reminder Sent At": value(l.reminderSentAt), Active: l.returnedAt ? "No" : "Yes" }))]
    ];
    const tables = []; for (const [name, rows] of data) tables.push(await sync(token, baseId, name, rows));
    const totals = tables.reduce((a, x) => ({ created: a.created + x.created, updated: a.updated + x.updated, skipped: a.skipped + x.skipped }), { created: 0, updated: 0, skipped: 0 });
    return Response.json({ tables, totals });
  } catch (error) {
    console.error("Airtable export failed", error);
    const message = error instanceof Error ? error.message : "Could not export to Airtable.";
    return Response.json({ error: message }, { status: message.includes("not configured") ? 503 : 502 });
  }
}
