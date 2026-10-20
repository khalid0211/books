import { fingerprint, type IdentityBook } from "./core";
import type { EnrichmentStatus } from "../catalogue-state";
type Revision = { id: number; inputFingerprint: string; knowledgeLevel: string; overview: string | null; reviewStatus: string };
export function catalogueEnrichmentStatus(book: IdentityBook, enrichment: { publishedRevisionId: number | null; revisions: Revision[] } | undefined): EnrichmentStatus {
  const latest = enrichment?.revisions[0];
  if (!latest) return "not_enriched";
  if (latest.inputFingerprint !== fingerprint(book)) return "stale";
  if (latest.knowledgeLevel === "insufficient" || !latest.overview?.trim()) return "insufficient";
  if (latest.reviewStatus === "approved" && enrichment?.publishedRevisionId === latest.id) return "published";
  return "needs_review";
}
