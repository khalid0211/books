import { prisma } from "../prisma";
import { cleanIsbn, isbn10to13, isValidIsbn } from "../isbn";
import { conceptKey, fingerprint, type IdentityBook } from "./core";

export const RELATED_ALGORITHM_VERSION = "concept-topics-v2";
type Concept = { id: number; name: string; weight: number; perspective: string | null };
export type RelatedInput = IdentityBook & { id: number; coverImageUrl: string | null; workId: string | null; concepts: Concept[] };
export type RelatedResult = { id: number; title: string; authors: string; coverImageUrl: string | null; score: number; explanation: string; matchType?: "canonical" | "topic"; matchedTerms?: string[]; sharedConcepts: { id: number; name: string; sourcePerspective: string | null; relatedPerspective: string | null }[] };
const broadConcepts = new Set(["history", "politics", "technology", "leadership", "society", "religion", "science", "culture", "biography", "economics", "power", "government", "human nature"]);
// Retrieval-only normalization: never merges concepts or changes editorial aliases.
const grammarWords = new Set("a an and are as at be been being by for from has have how in into is it its of on or that the their this through to under was were which with without".split(" "));
const topicStopWords = new Set([...grammarWords, ..."book books author authors account analysis approach central concept concepts context development focus idea ideas major role study understanding overview explores examines discusses historical history political politics social society cultural culture leadership human nature power science scientific technology religion religious biography economics government".split(" ")]);
function topicTerms(name: string, includeGeneric = false) {
  return [...new Set(conceptKey(name).split(" ").map(word => word.length > 5 && word.endsWith("ies") ? word.slice(0, -3) + "y" : word.length > 4 && word.endsWith("s") && !/(ss|us|is)$/.test(word) ? word.slice(0, -1) : word).filter(word => word.length >= 3 && !(includeGeneric ? grammarWords : topicStopWords).has(word) && !/^\d+$/.test(word)))];
}
function topicVector(concepts: Map<number, Concept>) {
  const terms = new Map<string, number>();
  for (const c of concepts.values()) if (c.weight >= 0.35 && !broadConcepts.has(conceptKey(c.name))) {
    for (const term of topicTerms(c.name)) terms.set(term, Math.max(terms.get(term) || 0, c.weight));
  }
  return terms;
}
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
  const empty = { books: [] as RelatedResult[], eligibleWorks: n, algorithmVersion: RELATED_ALGORITHM_VERSION, sourceEligible: Boolean(source), comparedWorks: Math.max(0, n - (source ? 1 : 0)) };
  if (!source) return empty;
  const topics = new Map(books.map(b => [b.id, topicVector(vectors.get(b.id)!)]));
  const workTopics = new Map<number, Set<string>>();
  for (const b of books) {
    const terms = workTopics.get(root(b.id)) || new Set<string>();
    for (const term of topics.get(b.id)!.keys()) terms.add(term);
    workTopics.set(root(b.id), terms);
  }
  const termFrequency = new Map<string, number>();
  for (const terms of workTopics.values()) for (const term of terms) termFrequency.set(term, (termFrequency.get(term) || 0) + 1);
  const termIdf = (term: string) => Math.log(1 + n / (1 + (termFrequency.get(term) || 0)));
  const sourceVector = vectors.get(source.id)!;
  const candidates: Array<RelatedResult & { group: number }> = [];
  for (const target of books) {
    if (root(target.id) === root(source.id)) continue;
    const targetVector = vectors.get(target.id)!;
    const shared = [...sourceVector.values()].filter(c => targetVector.has(c.id)).map(c => ({ ...c, related: targetVector.get(c.id)!, importance: Math.min(c.weight, targetVector.get(c.id)!.weight) * idf(c.id) })).sort((a, b) => b.importance - a.importance || a.id - b.id);
    const meaningful = shared.filter(c => !broadConcepts.has(conceptKey(c.name)) && Math.min(c.weight, c.related.weight) >= 0.35);
    const distinctive = meaningful.some(c => n >= 10 && (frequency.get(c.id) || 0) <= Math.max(2, n * 0.1) && Math.min(c.weight, c.related.weight) >= 0.75);
    let intersection = 0, union = 0;
    for (const id of new Set([...sourceVector.keys(), ...targetVector.keys()])) {
      const a = sourceVector.get(id)?.weight || 0, b = targetVector.get(id)?.weight || 0;
      intersection += Math.min(a, b) * idf(id); union += Math.max(a, b) * idf(id);
    }
    const score = union ? intersection / union : 0;
    if ((meaningful.length < 2 && !distinctive) || score < 0.12) {
      // Individually generated names often describe the same topic differently.
      // Require at least two substantive shared terms; generic labels alone fail.
      // Exact shared assignments already received the canonical policy above;
      // do not use token matching to bypass its weak/generic-overlap safeguards.
      const sourceTopics = topicVector(new Map([...sourceVector].filter(([id]) => !targetVector.has(id))));
      const targetTopics = topicVector(new Map([...targetVector].filter(([id]) => !sourceVector.has(id))));
      const common = [...sourceTopics.keys()].filter(term => targetTopics.has(term)).sort((a, b) => termIdf(b) - termIdf(a) || a.localeCompare(b));
      if (common.length < 2) continue;
      let dot = 0, normA = 0, normB = 0;
      for (const [term, weight] of sourceTopics) { const a = weight * termIdf(term), b = (targetTopics.get(term) || 0) * termIdf(term); dot += a * b; normA += a * a; }
      for (const [term, weight] of targetTopics) normB += (weight * termIdf(term)) ** 2;
      let similarity = normA && normB ? dot / Math.sqrt(normA * normB) : 0;
      // A near-identical phrase such as "Trade and cultural exchange" /
      // "Cultural exchange" remains evidence even in a subject-heavy library.
      // The two substantive shared-term requirement above still applies.
      for (const a of sourceVector.values()) if (a.weight >= 0.35 && !targetVector.has(a.id)) {
        const termsA = topicTerms(a.name, true);
        for (const b of targetVector.values()) if (b.weight >= 0.35 && !sourceVector.has(b.id)) {
          const termsB = topicTerms(b.name, true), overlap = termsA.filter(term => termsB.includes(term));
          const coverage = overlap.length / Math.max(termsA.length, termsB.length, 1);
          if (overlap.length >= 2 && overlap.some(term => common.includes(term)) && coverage >= 0.6) similarity = Math.max(similarity, coverage * 0.3);
        }
      }
      if (similarity < 0.12) continue;
      const terms = common.slice(0, 4);
      candidates.push({ id: target.id, title: target.title, authors: target.authors, coverImageUrl: target.coverImageUrl, group: root(target.id), score: Number((similarity * 0.8).toFixed(5)), matchType: "topic", matchedTerms: terms, explanation: `Related topics in the approved concept descriptions: ${terms.join(", ")}.`, sharedConcepts: [] });
      continue;
    }
    const reasons = meaningful.slice(0, 3);
    const names = reasons.map(c => c.name);
    const topicLabel = names.length === 1 ? names[0] : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
    candidates.push({ id: target.id, title: target.title, authors: target.authors, coverImageUrl: target.coverImageUrl, group: root(target.id), score: Number(score.toFixed(5)), matchType: "canonical", explanation: `Both books explore ${topicLabel}.`, sharedConcepts: reasons.map(c => ({ id: c.id, name: c.name, sourcePerspective: c.perspective, relatedPerspective: c.related.perspective })) });
  }
  candidates.sort((a, b) => b.score - a.score || a.id - b.id);
  const seen = new Set<number>(), result: RelatedResult[] = [];
  for (const { group, ...candidate } of candidates) {
    if (seen.has(group)) continue;
    seen.add(group); result.push(candidate);
    if (result.length >= Math.max(1, Math.min(5, limit))) break;
  }
  return { ...empty, books: result };
}

export async function relatedBooks(bookId: number, limit = 5) {
  // Only current, published revisions and approved canonical assignments enter the
  // graph. Re-reading avoids cache invalidation errors after edits/restores.
  const rows = await prisma.bookEnrichment.findMany({ where: { OR: [{ publishedRevisionId: { not: null } }, { bookId }] }, select: {
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
  const result = rankRelatedBooks(books, bookId, limit);
  const sourceRow = rows.find(row => row.book.id === bookId), revision = sourceRow?.publishedRevision;
  const sourceStatus = !sourceRow ? "not_enriched" : !revision ? "unpublished" : revision.inputFingerprint !== fingerprint(sourceRow.book) ? "stale" : !result.sourceEligible ? "unavailable" : !books.find(book => book.id === bookId)?.concepts.length ? "no_concepts" : "ready";
  return { ...result, sourceStatus };

}
