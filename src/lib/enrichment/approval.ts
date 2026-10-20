import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { conceptKey, fingerprint } from "./core";

type ApprovalInput = { overview: string | null; knowledgeLevel: string; modelIdentityStatus: string | null; identityStatus: string; generatedOutput: string };
export function sufficientForAutomaticApproval(r: ApprovalInput) {
  if (!r.overview?.trim() || r.knowledgeLevel === "insufficient") return { status: "insufficient", reason: "No sufficient overview was produced." };
  if (!["high", "medium"].includes(r.knowledgeLevel)) return { status: "needs_review", reason: "Low or unknown model knowledge needs attention." };
  let modelIdentity = r.modelIdentityStatus;
  if (!modelIdentity) { try { modelIdentity = JSON.parse(r.generatedOutput).identity_match; } catch {} }
  if (!modelIdentity && ["verified", "owner_confirmed"].includes(r.identityStatus)) modelIdentity = "confirmed";
  if (modelIdentity !== "confirmed") return { status: "needs_review", reason: "The intended book identity is uncertain." };
  return { status: "approved", reason: "Automatically approved: sufficient overview and confidently identified work. AI-generated, not full-text verified." };
}
export async function autoApproveRevision(tx: Prisma.TransactionClient, id: number) {
  const r = await tx.bookEnrichmentRevision.findUnique({ where: { id }, include: { concepts: { orderBy: [{ weight: "desc" }, { id: "asc" }] }, enrichment: { include: { book: true, revisions: { select: { id: true }, orderBy: { id: "desc" }, take: 1 }, publishedRevision: true } } } });
  if (!r) return "skipped";
  const entry = r.enrichment;
  if (r.reviewStatus === "approved") return "skipped";
  const legacyUnpublication = !entry.publishedRevisionId && await tx.bookEnrichmentRevision.count({ where: { bookId: r.bookId, id: { not: id }, reviewStatus: "approved", OR: [{ approvalSource: "owner" }, { editedAt: { not: null } }, { identityStatus: "owner_confirmed" }] } });
  let decision = sufficientForAutomaticApproval(r);
  if (entry.revisions[0]?.id !== id || r.inputFingerprint !== fingerprint(entry.book)) decision = { status: "stale", reason: "A newer revision or changed book identity requires regeneration." };
  else if (entry.manuallyLocked || entry.autoApprovalBlocked || legacyUnpublication || r.editedAt || (entry.publishedRevision && (entry.publishedRevision.approvalSource === "owner" || entry.publishedRevision.editedAt))) decision = { status: "skipped", reason: "Manual locks, publication decisions or corrections were preserved." };
  const kept = r.concepts.filter(c => c.reviewStatus !== "suppressed");
  if (decision.status === "approved" && kept.length < 3) decision = { status: "needs_review", reason: "Fewer than three usable concepts; review the enrichment." };
  if (decision.status !== "approved") {
    await tx.bookEnrichmentRevision.update({ where: { id }, data: { autoApprovalCheckedAt: new Date(), approvalNote: decision.reason, ...(decision.status === "insufficient" ? { reviewStatus: "insufficient" } : {}) } });
    return decision.status;
  }
  const assigned = new Set<number>();
  for (const c of kept) {
    const key = conceptKey(c.proposedName || c.originalTerm);
    if (!key || !Number.isFinite(c.weight) || c.weight <= 0 || c.weight > 1) continue;
    const alias = await tx.conceptAlias.findUnique({ where: { nameKey: key } });
    const conceptId = c.conceptId ?? alias?.conceptId ?? (await tx.concept.upsert({ where: { nameKey: key }, create: { name: c.proposedName || c.originalTerm, nameKey: key }, update: {} })).id;
    await tx.bookConcept.update({ where: { id: c.id }, data: { conceptId, reviewStatus: assigned.has(conceptId) ? "suppressed" : "approved" } });
    assigned.add(conceptId);
  }
  if (assigned.size < 2) {
    await tx.bookEnrichmentRevision.update({ where: { id }, data: { autoApprovalCheckedAt: new Date(), approvalNote: "Insufficient distinct usable concepts; review required." } });
    return "needs_review";
  }
  await tx.bookEnrichmentRevision.update({ where: { id }, data: { reviewStatus: "approved", approvalSource: "automatic", approvedAt: new Date(), autoApprovalCheckedAt: new Date(), approvalNote: decision.reason } });
  await tx.bookEnrichment.update({ where: { bookId: r.bookId }, data: { publishedRevisionId: id } });
  await tx.enrichmentJobItem.updateMany({ where: { revisionId: id, status: { in: ["needs_review", "insufficient"] } }, data: { status: "approved" } });
  return "approved";
}
export async function approveExistingEnrichments(limit = 20, recheck = false) {
  const candidates = await prisma.bookEnrichmentRevision.findMany({ where: { reviewStatus: "needs_review", ...(recheck ? {} : { autoApprovalCheckedAt: null }) }, select: { id: true }, orderBy: { id: "asc" }, take: Math.max(1, Math.min(100, limit)) });
  const counts = { approved: 0, insufficient: 0, needsReview: 0, skipped: 0, remaining: 0 };
  for (const candidate of candidates) {
    const status = await prisma.$transaction(async tx => {
      // Older jobs did not link their output revision. Attach only the most recent
      // matching completed attempt whose run window contains this revision.
      const r = await tx.bookEnrichmentRevision.findUnique({ where: { id: candidate.id } });
      if (r) {
        const item = await tx.enrichmentJobItem.findFirst({ where: { bookId: r.bookId, revisionId: null, status: "needs_review", job: { model: r.model, createdAt: { lte: r.createdAt }, updatedAt: { gte: r.createdAt } } }, orderBy: { id: "desc" } });
        if (item) await tx.enrichmentJobItem.update({ where: { id: item.id }, data: { revisionId: r.id } });
      }
      const result = await autoApproveRevision(tx, candidate.id);
      if (result === "insufficient") await tx.enrichmentJobItem.updateMany({ where: { revisionId: candidate.id, status: "needs_review" }, data: { status: "insufficient" } });
      return result;
    });
    if (status === "approved") counts.approved++;
    else if (status === "insufficient") counts.insufficient++;
    else if (status === "needs_review") counts.needsReview++;
    else counts.skipped++;
  }
  counts.remaining = await prisma.bookEnrichmentRevision.count({ where: { reviewStatus: "needs_review", autoApprovalCheckedAt: null } });
  return counts;
}
