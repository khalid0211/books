import { authorize, READ, WRITE, OWNER } from "@/lib/auth";
import { NextResponse } from "next/server";
import { queueOpenLibrary } from "@/lib/open-library-queue";
import {
  cleanIsbn,
  isValidIsbn,
  isbn10to13,
  normalizePubDate,
  normalizeLanguage,
  type LookupResult,
} from "@/lib/isbn";

export const dynamic = "force-dynamic";

const UA = "BookCatalog/0.1 (personal library app)";
const TIMEOUT_MS = 15000;
type JsonResult = { data: any; error?: string; retryable?: boolean };

async function getJson(url: string): Promise<JsonResult> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) return {
      data: null,
      error: res.status === 429 ? "request quota/rate limit reached" : `HTTP ${res.status}`,
      retryable: res.status === 408 || res.status >= 500,
    };
    return { data: await res.json() };
  } catch {
    return { data: null, error: "connection failed or timed out", retryable: true };
  } finally {
    clearTimeout(t);
  }
}

async function getOpenLibrary(url: string): Promise<JsonResult> {
  const first = await queueOpenLibrary(() => getJson(url));
  // Retry transient failures once, through the same one-second queue.
  return first.retryable ? queueOpenLibrary(() => getJson(url)) : first;
}

function firstStr(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}

/** Open Library — no key, rate-limited, primary source. */
function parseOpenLibrary(payload: any, isbn: string) {
  const rec = payload?.[`ISBN:${isbn}`];
  if (!rec) return null;
  const ids = rec.identifiers ?? {};
  const title = [rec.title, rec.subtitle].filter(Boolean).join(": ") || null;
  return {
    title,
    authors: Array.isArray(rec.authors)
      ? rec.authors.map((a: any) => a?.name).filter(Boolean).join(", ") || null
      : null,
    isbn10: ids.isbn_10?.[0] ?? null,
    isbn13: ids.isbn_13?.[0] ?? null,
    publisher: Array.isArray(rec.publishers)
      ? rec.publishers.map((p: any) => p?.name).filter(Boolean).join(", ") || null
      : null,
    publicationDate: normalizePubDate(rec.publish_date),
    pageCount: Number.isFinite(rec.number_of_pages) ? Number(rec.number_of_pages) : null,
    language: null as string | null, // jscmd=data omits language
    tags: Array.isArray(rec.subjects)
      ? rec.subjects.slice(0, 6).map((s: any) => s?.name).filter(Boolean).join(", ") || null
      : null,
    coverImageUrl: firstStr(rec.cover?.large, rec.cover?.medium),
  };
}

/** Google Books — richer language/categories/cover, but shared anonymous quota. */
function parseGoogleBooks(payload: any) {
  const info = payload?.items?.[0]?.volumeInfo;
  if (!info) return null;
  const ind: any[] = info.industryIdentifiers ?? [];
  const pick = (type: string) => ind.find((i) => i.type === type)?.identifier ?? null;
  let cover: string | null = firstStr(info.imageLinks?.thumbnail, info.imageLinks?.smallThumbnail);
  if (cover) cover = cover.replace(/^http:/, "https:").replace(/&edge=curl/, "");
  return {
    title: [info.title, info.subtitle].filter(Boolean).join(": ") || null,
    authors: Array.isArray(info.authors) ? info.authors.join(", ") || null : null,
    isbn10: pick("ISBN_10"),
    isbn13: pick("ISBN_13"),
    publisher: firstStr(info.publisher),
    publicationDate: normalizePubDate(info.publishedDate),
    pageCount: Number.isFinite(info.pageCount) ? Number(info.pageCount) : null,
    language: normalizeLanguage(info.language),
    tags: Array.isArray(info.categories) ? info.categories.slice(0, 6).join(", ") || null : null,
    coverImageUrl: cover,
  };
}

// GET /api/lookup?isbn=9780132350884
export async function GET(req: Request) {
  const denied = await authorize(req, WRITE); if (denied) return denied;
  const raw = new URL(req.url).searchParams.get("isbn") ?? "";
  const isbn = cleanIsbn(raw);

  if (!isbn) return NextResponse.json({ error: "Missing isbn parameter" }, { status: 400 });
  if (!isValidIsbn(isbn)) {
    return NextResponse.json({ error: "That is not a valid ISBN-10 or ISBN-13" }, { status: 400 });
  }

  const isbn13 = isbn.length === 13 ? isbn : isbn10to13(isbn);
  const queryIsbn = isbn13 ?? isbn;

  const [olRaw, gbRaw] = await Promise.all([
    getOpenLibrary(`https://openlibrary.org/api/books?bibkeys=ISBN:${queryIsbn}&format=json&jscmd=data`),
    getJson(`https://www.googleapis.com/books/v1/volumes?q=isbn:${queryIsbn}`),
  ]);

  const ol = parseOpenLibrary(olRaw.data, queryIsbn);
  const gb = parseGoogleBooks(gbRaw.data);

  if (!ol && !gb) {
    const failures = [
      olRaw.error ? `Open Library: ${olRaw.error}` : null,
      gbRaw.error ? `Google Books: ${gbRaw.error}` : null,
    ].filter(Boolean);
    if (failures.length) {
      return NextResponse.json(
        { error: `Lookup incomplete (${failures.join("; ")}). Please try again. This does not mean the book is missing.` },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: "No metadata found for this ISBN in Open Library or Google Books" },
      { status: 404 },
    );
  }

  // Merge field-by-field: Open Library wins, Google Books fills the gaps.
  const merged: LookupResult = {
    title: ol?.title ?? gb?.title ?? null,
    authors: ol?.authors ?? gb?.authors ?? null,
    isbn10: ol?.isbn10 ?? gb?.isbn10 ?? (isbn.length === 10 ? isbn : null),
    isbn13: ol?.isbn13 ?? gb?.isbn13 ?? isbn13 ?? null,
    publisher: ol?.publisher ?? gb?.publisher ?? null,
    publicationDate: ol?.publicationDate ?? gb?.publicationDate ?? null,
    pageCount: ol?.pageCount ?? gb?.pageCount ?? null,
    language: gb?.language ?? ol?.language ?? null,
    tags: ol?.tags ?? gb?.tags ?? null,
    coverImageUrl: gb?.coverImageUrl ?? ol?.coverImageUrl ?? null,
    subjects: [...new Set<string>([...(Array.isArray(olRaw.data?.[`ISBN:${queryIsbn}`]?.subjects) ? olRaw.data[`ISBN:${queryIsbn}`].subjects.map((s: any) => s?.name).filter((s: unknown): s is string => typeof s === "string") : []), ...(Array.isArray(gbRaw.data?.items?.[0]?.volumeInfo?.categories) ? gbRaw.data.items[0].volumeInfo.categories.filter((s: unknown): s is string => typeof s === "string") : [])])],
    sources: [ol ? "Open Library" : null, gb ? "Google Books" : null].filter(Boolean) as string[],
  };

  return NextResponse.json(merged);
}
