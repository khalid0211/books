/**
 * Shared book field definitions, types, and a dependency-free validator used by
 * both the API route handlers and the form component.
 */

export const FORMATS = [
  "hardcover",
  "paperback",
  "ebook",
  "audiobook",
  "other",
] as const;

export type BookFormat = (typeof FORMATS)[number];

export type BookInput = {
  ownerId: number | null;
  title: string;
  authors: string;
  isbn10: string | null;
  isbn13: string | null;
  publisher: string | null;
  publicationDate: string | null;
  edition: string | null;
  language: string | null;
  pageCount: number | null;
  tags: string | null;
  format: string | null;
  shelfLocation: string | null;
  dateAcquired: string | null;
  price: number | null;
  rating: number | null;
  coverImageUrl: string | null;
  notes: string | null;
};

export type Book = BookInput & {
  bookType?: string | null;
  categories?: { id: number; name: string }[];
  owner?: { id: number; name: string } | null;
  id: number;
  createdAt: string;
  updatedAt: string;
};

/** Permanent collection number, derived from the existing database ID. */
export function bookNumber(id: number): string {
  return `B${String(id).padStart(6, "0")}`;
}

/** A field that renders as one control in the form. */
export type FieldDef = {
  name: keyof BookInput;
  label: string;
  type: "text" | "textarea" | "number" | "date" | "select" | "url";
  required?: boolean;
  placeholder?: string;
  options?: readonly string[];
  min?: number;
  max?: number;
  step?: string;
  /** Put two short fields on one row on wider screens. */
  half?: boolean;
};

export const FIELD_DEFS: FieldDef[] = [
  { name: "ownerId", label: "Book owner", type: "select" },
  { name: "title", label: "Title", type: "text", required: true, placeholder: "Book title" },
  { name: "authors", label: "Author(s)", type: "text", placeholder: "Comma-separated" },
  { name: "isbn13", label: "ISBN-13", type: "text", half: true, placeholder: "9780…" },
  { name: "isbn10", label: "ISBN-10", type: "text", half: true },
  { name: "publisher", label: "Publisher", type: "text", half: true },
  { name: "publicationDate", label: "Publication date", type: "date", half: true },
  { name: "edition", label: "Edition", type: "text", half: true },
  { name: "language", label: "Language", type: "text", half: true },
  { name: "pageCount", label: "Pages", type: "number", half: true, min: 0, step: "1" },
  { name: "format", label: "Format", type: "select", half: true, options: FORMATS },
  { name: "tags", label: "Tags", type: "text", placeholder: "Comma-separated" },
  { name: "shelfLocation", label: "Shelf location", type: "text", half: true },
  { name: "dateAcquired", label: "Date acquired", type: "date", half: true },
  { name: "price", label: "Price", type: "number", half: true, min: 0, step: "0.01" },
  { name: "rating", label: "Rating (1–5)", type: "number", half: true, min: 1, max: 5, step: "1" },
  { name: "coverImageUrl", label: "Cover image URL", type: "url", placeholder: "https://…" },
  { name: "notes", label: "Notes", type: "textarea" },
];

export function emptyBookInput(): BookInput {
  return {
    ownerId: null,
    title: "",
    authors: "",
    isbn10: null,
    isbn13: null,
    publisher: null,
    publicationDate: null,
    edition: null,
    language: null,
    pageCount: null,
    tags: null,
    format: null,
    shelfLocation: null,
    dateAcquired: null,
    price: null,
    rating: null,
    coverImageUrl: null,
    notes: null,
  };
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

function toStr(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function toNum(v: unknown, field: string): number | null {
  const s = toStr(v);
  if (s === null) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) throw new ValidationError(`${field} must be a number`);
  return n;
}

function toInt(v: unknown, field: string): number | null {
  const n = toNum(v, field);
  if (n === null) return null;
  if (!Number.isInteger(n)) throw new ValidationError(`${field} must be a whole number`);
  return n;
}

/** Validate and normalise an arbitrary request body into a BookInput. */
export function parseBookInput(body: unknown): BookInput {
  if (!body || typeof body !== "object") {
    throw new ValidationError("Request body must be a JSON object");
  }
  const b = body as Record<string, unknown>;

  const title = toStr(b.title);
  if (!title) throw new ValidationError("Title is required");

  const ownerId = toInt(b.ownerId, "Book owner");
  if (ownerId !== null && (!Number.isSafeInteger(ownerId) || ownerId < 1 || typeof b.ownerId === "boolean")) throw new ValidationError("Select a valid book owner");

  const rating = toInt(b.rating, "Rating");
  if (rating !== null && (rating < 1 || rating > 5)) {
    throw new ValidationError("Rating must be between 1 and 5");
  }

  const pageCount = toInt(b.pageCount, "Pages");
  if (pageCount !== null && pageCount < 0) {
    throw new ValidationError("Pages cannot be negative");
  }

  const price = toNum(b.price, "Price");
  if (price !== null && price < 0) {
    throw new ValidationError("Price cannot be negative");
  }

  const format = toStr(b.format);
  if (format !== null && !FORMATS.includes(format as BookFormat)) {
    throw new ValidationError(`Format must be one of: ${FORMATS.join(", ")}`);
  }

  return {
    ownerId,
    title,
    authors: toStr(b.authors) ?? "",
    isbn10: toStr(b.isbn10),
    isbn13: toStr(b.isbn13),
    publisher: toStr(b.publisher),
    publicationDate: toStr(b.publicationDate),
    edition: toStr(b.edition),
    language: toStr(b.language),
    pageCount,
    tags: toStr(b.tags),
    format,
    shelfLocation: toStr(b.shelfLocation),
    dateAcquired: toStr(b.dateAcquired),
    price,
    rating,
    coverImageUrl: toStr(b.coverImageUrl),
    notes: toStr(b.notes),
  };
}

/** Best-effort publication year for compact display. */
export function pubYear(book: Pick<Book, "publicationDate">): string {
  if (!book.publicationDate) return "";
  const m = /^(\d{4})/.exec(book.publicationDate);
  return m ? m[1] : "";
}
