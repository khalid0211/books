/** Pure ISBN + metadata-normalisation helpers (no DOM, safe on server or client). */

/** Strip separators, uppercase the trailing X. */
export function cleanIsbn(raw: string): string {
  return raw.replace(/[^0-9Xx]/g, "").toUpperCase();
}

export function isValidIsbn10(s: string): boolean {
  if (!/^\d{9}[\dX]$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const c = s[i];
    const v = c === "X" ? 10 : Number(c);
    sum += v * (10 - i);
  }
  return sum % 11 === 0;
}

export function isValidIsbn13(s: string): boolean {
  if (!/^\d{13}$/.test(s)) return false;
  if (!s.startsWith("978") && !s.startsWith("979")) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) sum += Number(s[i]) * (i % 2 === 0 ? 1 : 3);
  return sum % 10 === 0;
}

export function isValidIsbn(raw: string): boolean {
  const s = cleanIsbn(raw);
  return s.length === 10 ? isValidIsbn10(s) : s.length === 13 ? isValidIsbn13(s) : false;
}

/** Convert a valid ISBN-10 to ISBN-13 (978 prefix). Returns null if not convertible. */
export function isbn10to13(raw: string): string | null {
  const s = cleanIsbn(raw);
  if (!isValidIsbn10(s)) return null;
  const core = "978" + s.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(core[i]) * (i % 2 === 0 ? 1 : 3);
  const check = (10 - (sum % 10)) % 10;
  return core + check;
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/**
 * Best-effort convert a publisher-supplied date into "YYYY-MM-DD".
 * Handles "2008", "2008-08", "2008-08-01", "July 2008", "Aug 1, 2008",
 * ISO timestamps, etc. Year-only becomes "YYYY-01-01".
 */
export function normalizePubDate(input: unknown): string | null {
  if (input == null) return null;
  const s = String(input).trim();
  if (!s) return null;

  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  m = /^(\d{4})-(\d{2})$/.exec(s);
  if (m) return `${m[1]}-${m[2]}-01`;

  // "July 2008" / "Jul 2008"
  m = /^([A-Za-z]{3,})\.?\s+(\d{4})$/.exec(s);
  if (m) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mo) return `${m[2]}-${mo}-01`;
  }

  // "August 1, 2008" / "Aug 1 2008"
  m = /^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s);
  if (m) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mo) return `${m[3]}-${mo}-${m[2].padStart(2, "0")}`;
  }

  const yr = /(\d{4})/.exec(s);
  return yr ? `${yr[1]}-01-01` : null;
}

const LANGS: Record<string, string> = {
  en: "English", eng: "English",
  fr: "French", fre: "French", fra: "French",
  de: "German", ger: "German", deu: "German",
  es: "Spanish", spa: "Spanish",
  it: "Italian", ita: "Italian",
  pt: "Portuguese", por: "Portuguese",
  nl: "Dutch", dut: "Dutch", nld: "Dutch",
  ru: "Russian", rus: "Russian",
  ar: "Arabic", ara: "Arabic",
  zh: "Chinese", chi: "Chinese", zho: "Chinese",
  ja: "Japanese", jpn: "Japanese",
  ur: "Urdu", urd: "Urdu",
  hi: "Hindi", hin: "Hindi",
};

export function normalizeLanguage(code: unknown): string | null {
  if (code == null) return null;
  const raw = String(code).trim();
  if (!raw) return null;
  const key = raw.replace(/^\/languages\//, "").toLowerCase();
  return LANGS[key] ?? raw;
}

/** Shape returned by /api/lookup and consumed by the form. */
export type LookupResult = {
  title: string | null;
  authors: string | null;
  isbn10: string | null;
  isbn13: string | null;
  publisher: string | null;
  publicationDate: string | null;
  pageCount: number | null;
  language: string | null;
  tags: string | null;
  coverImageUrl: string | null;
  sources: string[];
};
