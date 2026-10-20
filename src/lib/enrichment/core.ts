import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const PROMPT_VERSION = "catalogue-v1";
export const MAX_OUTPUT_TOKENS = 2400;
export class EnrichmentError extends Error {
  constructor(message: string, public retryable = false, public retryAfterMs = 0) { super(message); }
}
export function secretKey() {
  const raw = process.env.ENRICHMENT_SECRET || "";
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32 || key.toString("base64") !== raw) throw new EnrichmentError("Set ENRICHMENT_SECRET to 32 random bytes encoded as base64 on the server.");
  return key;
}
export function encryptKey(value: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(v => v.toString("base64")).join(".");
}
export function decryptKey(value: string) {
  try {
    const [iv, tag, encrypted] = value.split(".").map(v => Buffer.from(v, "base64"));
    const decipher = createDecipheriv("aes-256-gcm", secretKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch { throw new EnrichmentError("API key cannot be decrypted. Restore the server ENRICHMENT_SECRET or re-enter the API key."); }
}
export function conceptKey(value: string) {
  // Preserve meaningful distinctions (including singular/plural); aliases are editorial.
  return value.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{Z}\s]+/gu, " ").trim();
}
export type IdentityBook = { title: string; authors: string; isbn10: string | null; isbn13: string | null; publicationDate: string | null; edition: string | null; language: string | null };
export function bookInput(book: IdentityBook) {
  return { title: book.title, authors: book.authors, isbn10: book.isbn10, isbn13: book.isbn13, publicationDate: book.publicationDate, edition: book.edition, language: book.language };
}
export function fingerprint(book: IdentityBook) { return createHash("sha256").update(JSON.stringify(bookInput(book))).digest("hex"); }
export function identityMatches(book: IdentityBook, candidate: { title?: string; authors?: string[] }) {
  const title = conceptKey(book.title).split(" ").filter(Boolean);
  const other = conceptKey(candidate.title || "").split(" ").filter(Boolean);
  const titleMatch = title.length > 0 && other.length > 0 && (title.join(" ") === other.join(" ") || (title.length >= 3 && title.every((v, i) => v === other[i])));
  const authors = conceptKey(book.authors);
  return titleMatch && Boolean(authors) && Boolean(candidate.authors?.length) && candidate.authors!.every(a => {
    const words = conceptKey(a).split(" ").filter(Boolean);
    return words.length >= 2 && words.every(w => authors.split(" ").includes(w));
  });
}
export type EnrichmentOutput = {
  identity_match: "confirmed" | "ambiguous" | "unmatched";
  knowledge_level: "high" | "medium" | "low" | "insufficient";
  overview: string | null; central_idea: string | null; limitations: string;
  concepts: { name: string; salience: number; perspective: string | null }[];
};
export const outputSchema = {
  type: "object", additionalProperties: false,
  properties: {
    identity_match: { type: "string", enum: ["confirmed", "ambiguous", "unmatched"] },
    knowledge_level: { type: "string", enum: ["high", "medium", "low", "insufficient"] },
    overview: { type: ["string", "null"] }, central_idea: { type: ["string", "null"] }, limitations: { type: "string" },
    concepts: { type: "array", items: { type: "object", additionalProperties: false, properties: { name: { type: "string" }, salience: { type: "number" }, perspective: { type: ["string", "null"] } }, required: ["name", "salience", "perspective"] } },
  }, required: ["identity_match", "knowledge_level", "overview", "central_idea", "limitations", "concepts"],
};
export function validateOutput(value: unknown): EnrichmentOutput {
  const v = value as EnrichmentOutput;
  const nullable = (s: unknown, max: number) => s === null || (typeof s === "string" && s.length <= max);
  if (!v || typeof v !== "object" || Object.keys(v).sort().join() !== [...outputSchema.required].sort().join() ||
    !["confirmed", "ambiguous", "unmatched"].includes(v.identity_match) || !["high", "medium", "low", "insufficient"].includes(v.knowledge_level) ||
    !nullable(v.overview, 4000) || !nullable(v.central_idea, 1500) || typeof v.limitations !== "string" || !v.limitations.trim() || v.limitations.length > 2000 ||
    !Array.isArray(v.concepts) || v.concepts.length > 8 || v.concepts.some(c => !c || Object.keys(c).sort().join() !== "name,perspective,salience" || typeof c.name !== "string" || !conceptKey(c.name) || c.name.length > 100 || !Number.isFinite(c.salience) || c.salience < 0 || c.salience > 1 || !nullable(c.perspective, 1500)) ||
    new Set(v.concepts.map(c => conceptKey(c.name))).size !== v.concepts.length) throw new EnrichmentError("The model returned invalid enrichment data; nothing was published.");
  if (v.knowledge_level === "insufficient" || v.identity_match !== "confirmed") return { ...v, overview: null, central_idea: null, concepts: [] };
  if (!v.overview?.trim() || v.concepts.length < 3) throw new EnrichmentError("The model omitted its overview or supplied fewer than three concepts.");
  return v;
}
export function tokenCost(input: number, output: number, rates: { inputRate: number; outputRate: number }) {
  return Math.ceil((input * rates.inputRate + output * rates.outputRate) / 1e6 * 1e8) / 1e8;
}
export function safeError(error: unknown) {
  return error instanceof EnrichmentError ? error.message : "Enrichment could not complete. Check server configuration and try again.";
}
