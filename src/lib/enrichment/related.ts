import { prisma } from "../prisma";
import { cleanIsbn, isbn10to13, isValidIsbn } from "../isbn";
import { conceptKey, fingerprint, type IdentityBook } from "./core";

export const RELATED_ALGORITHM_VERSION = "concept-jaccard-v1";
type Concept = { id: number; name: string; weight: number; perspective: string | null };
export type RelatedInput = IdentityBook & { id: number; coverImageUrl: string | null; workId: string | null; concepts: Concept[] };
export type RelatedResult = { id: number; title: string; authors: string; coverImageUrl: string | null; score: number; explanation: string; sharedConcepts: { id: number; name: string; sourcePerspective: string | null; relatedPerspective: string | null }[] };
const broadConcepts = new Set(["history", "politics", "technology", "leadership", "society", "religion", "science", "culture", "biography", "economics", "power", "government", "human nature"]);
function vector(book: RelatedInput) {
  const result = new Map<number, Concept>();
  for (const c of book.concepts) if (Number.isSafeInteger(c.id) && Number.isFinite(c.weight) && c.weight > 0 && c.weight <= 1 && (!result.has(c.id) || result.get(c.id)!.weight < c.weight)) result.set(c.id, c);
  return result;
}
function duplicateKeys(book: RelatedInput) {
  const keys: string[] = [];
  if (book.workId) keys.push(`work:${book.workId}`);
  if (conceptKey(book.title) && conceptKey(book.authors)) keys.push(`title:${conceptKey(book.title)}|${conceptKey(book.authors)}`);
  for (const raw of [book.isbn10, book.isbn13]) {
    const isbn = cleanIsbn(raw || "");
    if (isValidIsbn(isbn)) keys.push(`isbn:${isbn.length === 10 ? isbn10to13(isbn) : isbn}`);
  }
  return keys;
}
export function rankRelatedBooks(books: RelatedInput[], bookId: number, limit = 5) {
  const source = books.find(b => b.id === bookId);
  if (!source) return { books: [] as RelatedResult[], eligibleWorks: 0, algorithmVersion: RELATED_ALGORITHM_VERSION };
  const parent = new Map(books.map(b => [b.id, b.id]));
  function root(id: number): number { const p = parent.get(id)!; if (p === id) return id; const r = root(p); parent.set(id, r); return r; }
  const keyOwners = new Map<string, number>();
  for (const book of books) for (const key of duplicateKeys(book)) {
    const existing = keyOwners.get(key);
    if (existing !== undefined) parent.set(root(book.id), root(existing));
    else keyOwners.set(key, book.id);
  }
  const vectors = new Map(books.map(b => [b.id, vector(b)]));
  const workConcepts = new Map<number, Set<number>>();
  for (const b of books) {
    const group = root(b.id), concepts = workConcepts.get(group) || new Set<number>();
    for (const id of vectors.get(b.id)!.keys()) concepts.add(id);
    workConcepts.set(group, concepts);
  }
  const n = workConcepts.size, frequency = new Map<number, number>();
  for (const concepts of workConcepts.values()) for (const id of concepts) frequency.set(id, (frequency.get(id) || 0) + 1);
  const idf = (id: number) => Math.log(1 + n / (1 + (frequency.get(id) || 0)));
  const sourceVector = vectors.get(source.id)!;
  const candidates: Array<RelatedResult & { group: number }> = [];
  for (const target of books) {
    if (root(target.id) === root(source.id)) continue;
    const targetVector = vectors.get(target.id)!;
    const shared = [...sourceVector.values()].filter(c => targetVector.has(c.id)).map(c => ({ ...c, related: targetVector.get(c.id)!, importance: Math.min(c.weight, targetVector.get(c.id)!.weight) * idf(c.id) })).sort((a, b) => b.importance - a.importance || a.id - b.id);
    const meaningful = shared.filter(c => !broadConcepts.has(conceptKey(c.name)) && Math.min(c.weight, c.related.weight) >= 0.35);
    const distinctive = meaningful.some(c => n >= 10 && (frequency.get(c.id) || 0) <= Math.max(2, n * 0.1) && Math.min(c.weight, c.related.weight) >= 0.75);
    if (meaningful.length < 2 && !distinctive) continue;
    let intersection = 0, union = 0;
    for (const id of new Set([...sourceVector.keys(), ...targetVector.keys()])) {
      const a = sourceVector.get(id)?.weight || 0, b = targetVector.get(id)?.weight || 0;
      intersection += Math.min(a, b) * idf(id); union += Math.max(a, b) * idf(id);
    }
    const score = union ? intersection / union : 0;
    if (score < 0.12) continue;
    const reasons = meaningful.slice(0, 3);
    const names = reasons.map(c => c.name);
    const topics = names.length === 1 ? names[0] : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
    candidates.push({ id: target.id, title: target.title, authors: target.authors, coverImageUrl: target.coverImageUrl, group: root(target.id), score: Number(score.toFixed(5)), explanation: `Both books explore ${topics}.`, sharedConcepts: reasons.map(c => ({ id: c.id, name: c.name, sourcePerspective: c.perspective, relatedPerspective: c.related.perspective })) });
  }
  candidates.sort((a, b) => b.score - a.score || a.id - b.id);
  const seen = new Set<number>(), result: RelatedResult[] = [];
  for (const { group, ...candidate } of candidates) {
    if (seen.has(group)) continue;
    seen.add(group); result.push(candidate);
    if (result.length >= Math.max(1, Math.min(5, limit))) break;
  }
  return { books: result, eligibleWorks: n, algorithmVersion: RELATED_ALGORITHM_VERSION };
}

export async function relatedBooks(bookId: number, limit = 5) {
  // Only current, published revisions and approved canonical assignments enter the
  // graph. Re-reading avoids cache invalidation errors after edits/restores.
  const rows = await prisma.bookEnrichment.findMany({ where: { publishedRevisionId: { not: null } }, select: {
    book: { select: { id: true, title: true, authors: true, isbn10: true, isbn13: true, publicationDate: true, edition: true, language: true, coverImageUrl: true } },
    publishedRevision: { select: { inputFingerprint: true, reviewStatus: true, knowledgeLevel: true, overview: true, olWorkId: true, olIdentityStatus: true, identityStatus: true, concepts: { where: { reviewStatus: "approved", conceptId: { not: null } }, select: { weight: true, perspective: true, concept: { select: { id: true, name: true, nameKey: true } } } } } },
  } });
  const aliases = new Map((await prisma.conceptAlias.findMany({ include: { concept: { select: { id: true, name: true } } } })).map(a => [a.nameKey, a.concept]));
  const books: RelatedInput[] = [];
  for (const row of rows) {
    const r = row.publishedRevision;
    if (!r || r.reviewStatus !== "approved" || r.knowledgeLevel === "insufficient" || !r.overview?.trim() || r.inputFingerprint !== fingerprint(row.book)) continue;
    const workVerified = r.olIdentityStatus === "verified" || (!r.olIdentityStatus && r.identityStatus === "verified");
    books.push({ ...row.book, workId: workVerified ? r.olWorkId : null, concepts: r.concepts.filter(c => c.concept).map(c => ({ ...(aliases.get(c.concept!.nameKey) || { id: c.concept!.id, name: c.concept!.name }), weight: c.weight, perspective: c.perspective })) });
  }
  return rankRelatedBooks(books, bookId, limit);
}
