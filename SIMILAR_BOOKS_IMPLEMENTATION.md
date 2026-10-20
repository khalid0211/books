# Automatic approval and similar books

User-authorized change: automatically approve sufficiently identified enrichments, including existing catalogue drafts, then show related books using the approved concepts. No new OpenAI requests for existing drafts or recommendations.

1. `prisma/schema.prisma`: additive automatic-approval audit fields, publication opt-out on BookEnrichment, and a revision link on job items. Keep physical copies and existing fields unchanged.
2. `src/lib/enrichment/approval.ts`: conservative sufficient-information predicate; canonicalize exact concept names/known aliases, preserve suppression/manual locks and manual unpublication. Approve new results inside the worker transaction and backfill existing drafts in bounded maintenance batches after deployment. Keep model identity separate from owner verification.
3. `src/lib/enrichment/related.ts`, `/api/books/[id]/related`: load current published concepts from SQLite and compute deterministic IDF-weighted Jaccard similarity. At ~700 books, on-demand computation avoids stale recommendation caches and a new graph service. Group duplicate works/copies for corpus frequencies and diversify recommendations. Require meaningful overlap and explain only real shared concepts; no agreement/influence claims.
4. Shared book enrichment panel: approved-by-policy label and related-books cards for every signed-in role, including empty states. Owner retains correction, unpublish and lock controls.
5. Catalogue/run UI: display automatic approval/insufficient outcomes and provide owner control to process existing enrichments without regeneration or API spend.
6. Backup/restore: new fields included automatically; staged upgrades preserve old data, approval provenance and publication opt-outs. Airtable keeps existing Books/Concepts/Book Concepts mappings; automatic approval naturally activates approved assignments. Recommendations are derived on demand, so restore cannot revive stale links.
7. Verification: isolated database coverage for approval/backfill/manual protections, duplicates, scoring thresholds, stale/suppressed content, publication changes, auth, API/UI shapes and backup/restore. No production data changes until deployment.


Matching correction: the live API returned 506 eligible distinct works but zero
matches for B000003. Published concepts on B000003 and B000010 use different
names for overlapping topics. Added retrieval-only topic token matching alongside
canonical matching, using IDF-weighted cosine similarity, generic-word filtering,
a two-term minimum, and explicit matched-word explanations. Canonical IDs, aliases,
approval requirements, duplicate grouping and suppression remain authoritative.
API/UI diagnostics now distinguish eligibility failures from absent topic overlap.
Regression fixtures use the observed concept wording in a 506-work synthetic
corpus; they are not a download or modification of the production database.
