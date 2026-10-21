import { prisma } from "../prisma";
import { parseBookId } from "../book-id";
import { conceptKey, decryptKey, encryptKey, EnrichmentError, fingerprint, secretKey } from "./core";
import { requestBody, reserveFor } from "./clients";
import { enrichmentSourceLabel, enrichmentSourceType } from "./provenance";

export async function settingsPublic() {
  const s = await prisma.enrichmentSettings.findUnique({ where: { id: 1 } });
  let keyUsable = false;
  try { if (s?.encryptedKey) { decryptKey(s.encryptedKey); keyUsable = true; } } catch { /* Show recovery state without disclosing ciphertext. */ }
  let encryptionReady = false; try { secretKey(); encryptionReady = true; } catch {}
  return { model: s?.model || "", inputRate: s?.inputRate || 0, outputRate: s?.outputRate || 0, budgetUsd: s?.budgetUsd ?? 1, maxBooks: s?.maxBooks ?? 10, keySaved: Boolean(s?.encryptedKey), keyUsable, encryptionReady };
}
export async function saveSettings(body: Record<string, unknown>) {
  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (!/^[\w.:-]{1,150}$/.test(model)) throw new EnrichmentError("Enter a valid OpenAI model ID.");
  const numbers = ["inputRate", "outputRate", "budgetUsd", "maxBooks"] as const;
  for (const field of numbers) if (typeof body[field] !== "number" || !Number.isFinite(body[field]) || Number(body[field]) <= 0) throw new EnrichmentError(`Enter a positive ${field}.`);
  if (!Number.isInteger(body.maxBooks) || Number(body.maxBooks) > 100 || Number(body.budgetUsd) > 100 || Number(body.inputRate) > 10000 || Number(body.outputRate) > 10000) throw new EnrichmentError("Use at most 100 books, a $100 run budget, and valid per-million token prices.");
  const key = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (key && (key.length < 20 || key.length > 512 || /\s/.test(key))) throw new EnrichmentError("Enter a valid API key.");
  const data = { model, inputRate: Number(body.inputRate), outputRate: Number(body.outputRate), budgetUsd: Number(body.budgetUsd), maxBooks: Number(body.maxBooks), ...(body.removeKey === true ? { encryptedKey: null } : key ? { encryptedKey: encryptKey(key) } : {}) };
  await prisma.enrichmentSettings.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
  return settingsPublic();
}
export async function usableSettings() {
  const s = await prisma.enrichmentSettings.findUnique({ where: { id: 1 } });
  if (!s?.encryptedKey || !s.model || s.inputRate <= 0 || s.outputRate <= 0) throw new EnrichmentError("Save an API key, model, and current token prices first.");
  return { ...s, key: decryptKey(s.encryptedKey) };
}
export async function previewRange(body: Record<string, unknown>) {
  const selection = body.selection ?? "range";
  if (selection !== "range" && selection !== "not_enriched") throw new EnrichmentError("Choose a catalogue range or not enriched books.");
  const s = await prisma.enrichmentSettings.findUnique({ where: { id: 1 } });
  const filtered = selection === "not_enriched";
  let startId = parseBookId(body.start), endId = parseBookId(body.end);
  if (filtered) {
    if (!Number.isInteger(body.limit) || Number(body.limit) < 1 || Number(body.limit) > (s?.maxBooks ?? 10)) throw new EnrichmentError(`Enter a number of books from 1 to ${s?.maxBooks ?? 10}.`);
  } else if (!startId || !endId || endId < startId || endId - startId >= 1000) throw new EnrichmentError("Enter an inclusive range of up to 1,000 book numbers, with the ending number at least the starting number.");
  const books = await prisma.book.findMany({ where: filtered
    ? { OR: [{ enrichment: { is: null } }, { enrichment: { is: { manuallyLocked: false, revisions: { none: {} } } } }] }
    : { id: { gte: startId!, lte: endId! } },
    ...(filtered ? { take: Number(body.limit) } : {}), include: { enrichment: { include: { revisions: { orderBy: { id: "desc" }, take: 1 } } } }, orderBy: { id: "asc" } });
  if (filtered) { startId = books[0]?.id ?? 0; endId = books.at(-1)?.id ?? 0; }
  const rows = books.map(b => {
    const latest = b.enrichment?.revisions[0];
    const reason = b.enrichment?.manuallyLocked ? "Manually locked" : !body.regenerate && latest && latest.inputFingerprint === fingerprint(b) ? "Already processed; select regenerate to retry" : "";
    return { id: b.id, title: b.title, authors: b.authors, eligible: !reason, reason };
  });
  const eligible = rows.filter(r => r.eligible).length;
  const source = { identityStatus: "verified", workId: null, editionId: null, description: "x".repeat(10000), sourceUrl: null, snapshot: "" };
  const estimate = books.reduce((sum, b, i) => sum + (rows[i].eligible ? reserveFor(requestBody(b, source, s?.model || "configured-model"), { inputRate: s?.inputRate || 0, outputRate: s?.outputRate || 0 }).usd : 0), 0);
  return { startId: startId!, endId: endId!, rows, missing: filtered ? 0 : endId! - startId! + 1 - rows.length, eligible, maxBooks: s?.maxBooks ?? 10, estimatedMaximumUsd: estimate, budgetUsd: s?.budgetUsd ?? 1 };
}
export async function createJob(body: Record<string, unknown>) {
  const settings = await usableSettings(), preview = await previewRange(body);
  if (!preview.eligible || preview.eligible > settings.maxBooks) throw new EnrichmentError(`Select 1–${settings.maxBooks} eligible books.`);
  if (preview.estimatedMaximumUsd > settings.budgetUsd) throw new EnrichmentError("The conservative first-attempt estimate exceeds the run budget. Reduce the range or increase the budget.");
  return prisma.$transaction(async tx => {
    if (await tx.enrichmentJob.count({ where: { status: { in: ["queued", "running"] } } })) throw new EnrichmentError("Pause or finish the current run before starting another.");
    return tx.enrichmentJob.create({ data: { startId: preview.startId, endId: preview.endId, regenerate: body.selection !== "not_enriched" && body.regenerate === true, model: settings.model, inputRate: settings.inputRate, outputRate: settings.outputRate, budgetUsd: settings.budgetUsd,
      items: { create: preview.rows.map(r => ({ bookId: r.id, status: r.eligible ? "queued" : "skipped", error: r.reason || null })) } }, include: { items: { include: { book: { select: { id: true, title: true } } }, orderBy: { id: "asc" } } } });
  });
}
export async function controlJob(id: number, action: unknown) {
  if (!["pause", "resume", "cancel", "retry"].includes(String(action))) throw new EnrichmentError("Unknown job action.");
  return prisma.$transaction(async tx => {
    const job = await tx.enrichmentJob.findUnique({ where: { id } });
    if (!job) throw new EnrichmentError("Run not found.");
    if (action === "pause") return tx.enrichmentJob.update({ where: { id }, data: { status: "paused", message: "Paused by owner; an in-flight book may finish." } });
    if (action === "cancel") return tx.enrichmentJob.update({ where: { id }, data: { status: "cancelled", message: "Cancelled; an in-flight book may finish." } });
    if (job.status === "cancelled") throw new EnrichmentError("Create a new run for a cancelled range.");
    if (await tx.enrichmentJob.count({ where: { id: { not: id }, status: { in: ["queued", "running"] } } })) throw new EnrichmentError("Another run is active.");
    if (action === "retry") await tx.enrichmentJobItem.updateMany({ where: { jobId: id, status: "failed" }, data: { status: "queued", attempts: 0, error: null, nextAttemptAt: new Date() } });
    return tx.enrichmentJob.update({ where: { id }, data: { status: "queued", message: null, summarySavedAt: null, summaryBooksProcessed: 0 } });
  });
}

export async function readRunSummary() {
  const rows = await prisma.enrichmentJob.findMany({ where: { summarySavedAt: { not: null } }, orderBy: { id: "asc" },
    select: { id: true, createdAt: true, status: true, inputTokens: true, outputTokens: true, accountedUsd: true, summaryBooksProcessed: true } });
  const totals = rows.reduce((sum, row) => ({ inputTokens: sum.inputTokens + row.inputTokens, outputTokens: sum.outputTokens + row.outputTokens,
    accountedUsd: sum.accountedUsd + row.accountedUsd, booksProcessed: sum.booksProcessed + row.summaryBooksProcessed }),
    { inputTokens: 0, outputTokens: 0, accountedUsd: 0, booksProcessed: 0 });
  return { rows, totals };
}

export async function saveRunSummary() {
  return prisma.$transaction(async tx => {
    // Include all finished history, even runs older than the recent-runs display limit.
    const jobs = await tx.enrichmentJob.findMany({ where: { summarySavedAt: null, status: { in: ["completed", "cancelled"] }, items: { none: { status: "running" } } },
      select: { id: true, items: { select: { status: true } } } });
    for (const job of jobs) {
      const processed = job.items.filter(item => ["approved", "needs_review", "insufficient", "failed"].includes(item.status)).length;
      await tx.enrichmentJob.update({ where: { id: job.id }, data: { summarySavedAt: new Date(), summaryBooksProcessed: processed } });
    }
    return { saved: jobs.length };
  });
}
export async function readEnrichment(bookId: number, owner: boolean) {
  const row = await prisma.bookEnrichment.findUnique({ where: { bookId }, include: { book: true, revisions: { orderBy: { id: "desc" }, include: { concepts: { include: { concept: true }, ...(owner ? {} : { where: { reviewStatus: "approved" } }) } }, take: owner ? 20 : 1, ...(owner ? {} : { where: { publishedFor: { bookId } } }) } } });
  if (!row) return { manuallyLocked: false, publishedRevisionId: null, revisions: [] };
  const revisions = row.revisions.filter(r => owner || r.inputFingerprint === fingerprint(row.book)).map(({ inputSnapshot, sourceSnapshot, generatedOutput, ...r }) => ({ ...r, sourceType: enrichmentSourceType(r), sourceLabel: enrichmentSourceLabel(r), stale: r.inputFingerprint !== fingerprint(row.book) }));
  return { manuallyLocked: row.manuallyLocked, publishedRevisionId: row.publishedRevisionId, revisions };
}
export async function reviewEnrichment(bookId: number, body: Record<string, any>) {
  return prisma.$transaction(async tx => {
    const entry = await tx.bookEnrichment.findUnique({ where: { bookId }, include: { book: true } });
    if (!entry) throw new EnrichmentError("No enrichment found.");
    if (body.action === "lock") return tx.bookEnrichment.update({ where: { bookId }, data: { manuallyLocked: body.locked === true } });
    if (body.action === "unpublish") return tx.bookEnrichment.update({ where: { bookId }, data: { publishedRevisionId: null, autoApprovalBlocked: true } });
    const revision = await tx.bookEnrichmentRevision.findFirst({ where: { id: Number(body.revisionId), bookId }, include: { concepts: true } });
    if (!revision) throw new EnrichmentError("Revision not found.");
    if (revision.inputFingerprint !== fingerprint(entry.book)) throw new EnrichmentError("Book identity changed. Regenerate enrichment before publishing.");
    if (body.action !== "publish") throw new EnrichmentError("Unknown review action.");
    if (!body.identityConfirmed) throw new EnrichmentError("Confirm the exact book identity after reviewing the source and content.");
    if (revision.knowledgeLevel === "insufficient" || !revision.overview) throw new EnrichmentError("Insufficient-knowledge results cannot be published. Correct catalogue metadata and regenerate.");
    const overview = String(body.overview ?? "").trim(), centralIdea = String(body.centralIdea ?? "").trim();
    if (!overview || overview.length > 4000 || centralIdea.length > 1500) throw new EnrichmentError("Enter an overview up to 4,000 characters and central idea up to 1,500.");
    if (!Array.isArray(body.concepts) || body.concepts.length > 8 || body.concepts.length !== revision.concepts.length) throw new EnrichmentError("Invalid concept edits.");
    const approvedConcepts = new Set<number>();
    for (const original of revision.concepts) {
      const edit = body.concepts.find((c: Record<string, unknown>) => c.id === original.id);
      if (!edit || typeof edit.name !== "string" || !conceptKey(edit.name) || edit.name.length > 100 || !Number.isFinite(edit.weight) || edit.weight < 0 || edit.weight > 1 || typeof edit.perspective !== "string" || edit.perspective.length > 1500) throw new EnrichmentError("Invalid concept name, weight or perspective.");
      let conceptId: number | null = null;
      if (!edit.suppressed) {
        const nameKey = conceptKey(edit.name);
        const alias = await tx.conceptAlias.findUnique({ where: { nameKey } });
        conceptId = alias?.conceptId ?? (await tx.concept.upsert({ where: { nameKey }, create: { name: edit.name.trim(), nameKey }, update: {} })).id;
        if (approvedConcepts.has(conceptId)) throw new EnrichmentError("Two terms map to the same canonical concept. Suppress one before publishing.");
        approvedConcepts.add(conceptId);
        const originalKey = conceptKey(original.originalTerm);
        // Alias decisions are explicit; never overwrite a prior alias to another concept.
        if (edit.saveAlias && originalKey !== nameKey) {
          const existing = await tx.conceptAlias.findUnique({ where: { nameKey: originalKey } });
          if (existing && existing.conceptId !== conceptId) throw new EnrichmentError("That original term already maps to another concept.");
          await tx.conceptAlias.upsert({ where: { nameKey: originalKey }, create: { nameKey: originalKey, conceptId }, update: {} });
        }
      }
      await tx.bookConcept.update({ where: { id: original.id }, data: { conceptId, proposedName: edit.name.trim(), weight: edit.weight, perspective: edit.perspective.trim() || null, reviewStatus: edit.suppressed ? "suppressed" : "approved" } });
    }
    await tx.bookEnrichmentRevision.update({ where: { id: revision.id }, data: { overview, centralIdea: centralIdea || null, reviewStatus: "approved", approvalSource: "owner", approvedAt: new Date(), editedAt: new Date(), identityStatus: "owner_confirmed" } });
    return tx.bookEnrichment.update({ where: { bookId }, data: { publishedRevisionId: revision.id, manuallyLocked: true, autoApprovalBlocked: false } });
  });
}
