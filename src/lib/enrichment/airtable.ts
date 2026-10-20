import { fingerprint, type IdentityBook } from "./core";
import { enrichmentSourceLabel, enrichmentSourceType } from "./provenance";
type Published = { approvalSource?: string | null; sourceType?: string | null; inputFingerprint: string; overview: string | null; centralIdea: string | null; olDescription: string | null; olSourceUrl: string | null; olWorkId: string | null; olEditionId: string | null; model: string; knowledgeLevel: string; createdAt: Date; concepts: { reviewStatus: string; concept: { name: string } | null }[] };
export function enrichmentBookFields(book: IdentityBook & { enrichment: { publishedRevision: Published | null } | null }) {
  const candidate = book.enrichment?.publishedRevision;
  const r = candidate?.inputFingerprint === fingerprint(book) ? candidate : null;
  return {
    "AI Overview": r?.overview ?? null, "Central Idea": r?.centralIdea ?? null, "Open Library Description": r?.olDescription ?? null,
    "Open Library Source": r?.olSourceUrl ?? null, "Open Library Work ID": r?.olWorkId ?? null, "Open Library Edition ID": r?.olEditionId ?? null,
    "Enrichment Status": r ? "published" : candidate ? "stale" : "unpublished", "Enrichment Model": r?.model ?? null,
    "Enrichment Knowledge": r?.knowledgeLevel ?? null, "Enriched At": r?.createdAt.toISOString() ?? null,
    "Enrichment Source": r ? enrichmentSourceType(r) : null, "AI Provenance": r ? `${enrichmentSourceLabel(r)}${r.approvalSource === "automatic" ? " Approved automatically under the library policy." : r.approvalSource === "owner" ? " Reviewed and approved by Owner." : ""}` : null,
    "Concepts": r?.concepts.filter(c => c.reviewStatus === "approved").map(c => c.concept?.name).filter(Boolean).sort().join(", ") || null,
  };
}
