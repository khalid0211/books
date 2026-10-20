import { randomUUID } from "node:crypto";
import { prisma } from "../prisma";
import { databaseRestoreRunning } from "../database-file";
import { bookInput, conceptKey, EnrichmentError, fingerprint, PROMPT_VERSION, safeError, tokenCost } from "./core";
import { callOpenAI, requestBody, reserveFor, retrieveSource } from "./clients";
import { usableSettings } from "./service";
import { enrichmentSourceLabel, enrichmentSourceType } from "./provenance";

const globalWorker = globalThis as typeof globalThis & { catalogueEnrichmentWorker?: { token: string; started: boolean; busy: boolean; recovered: boolean; warned: boolean } };
const state = globalWorker.catalogueEnrichmentWorker ??= { token: randomUUID(), started: false, busy: false, recovered: false, warned: false };
export async function quiesceEnrichment() {
  await prisma.enrichmentJob.updateMany({ where: { status: { in: ["queued", "running"] } }, data: { status: "paused", message: "Paused for database restore." } });
  for (let i = 0; i < 30 && state.busy; i++) await new Promise(r => setTimeout(r, 500));
  if (state.busy) throw new EnrichmentError("An enrichment request is finishing. Runs are paused; retry restore shortly.");
}
export function resetEnrichmentWorker() { state.recovered = false; }

export async function processNextItem() {
  const job = await prisma.enrichmentJob.findFirst({ where: { status: { in: ["queued", "running"] } }, orderBy: { id: "asc" } });
  if (!job || databaseRestoreRunning()) return;
  const item = await prisma.enrichmentJobItem.findFirst({ where: { jobId: job.id, status: "queued", nextAttemptAt: { lte: new Date() } }, orderBy: { id: "asc" }, include: { book: { include: { enrichment: { include: { revisions: { take: 1, orderBy: { id: "desc" } } } } } } } });
  if (!item) {
    if (!await prisma.enrichmentJobItem.count({ where: { jobId: job.id, status: { in: ["queued", "running"] } } })) await prisma.enrichmentJob.updateMany({ where: { id: job.id, status: { in: ["queued", "running"] } }, data: { status: "completed", message: "Run complete. Review draft results before publishing." } });
    return;
  }
  const inputFingerprint = fingerprint(item.book), latest = item.book.enrichment?.revisions[0];
  if (item.book.enrichment?.manuallyLocked || (!job.regenerate && latest?.inputFingerprint === inputFingerprint)) {
    await prisma.enrichmentJobItem.update({ where: { id: item.id }, data: { status: "skipped", error: "Locked or already processed." } }); return;
  }
  await prisma.enrichmentJob.updateMany({ where: { id: job.id, status: "queued" }, data: { status: "running" } });
  const claimed = await prisma.enrichmentJobItem.updateMany({ where: { id: item.id, status: "queued" }, data: { status: "running", attempts: { increment: 1 }, error: null } });
  if (!claimed.count) return;
  try {
    const settings = await usableSettings();
    const source = await retrieveSource(item.book);
    const body = requestBody(item.book, source, job.model), reservation = reserveFor(body, job);
    // Atomically reserve a conservative charge before sending anything billable.
    const reserved = await prisma.enrichmentJob.updateMany({ where: { id: job.id, status: "running", accountedUsd: { lte: job.budgetUsd - reservation.usd } }, data: { accountedUsd: { increment: reservation.usd } } });
    if (!reserved.count || databaseRestoreRunning()) {
      if (reserved.count) await prisma.enrichmentJob.update({ where: { id: job.id }, data: { accountedUsd: { decrement: reservation.usd } } });
      await prisma.enrichmentJobItem.update({ where: { id: item.id }, data: { status: "queued", attempts: { decrement: 1 }, error: "Run paused or budget exhausted before API request." } });
      await prisma.enrichmentJob.updateMany({ where: { id: job.id, status: "running" }, data: { status: "paused", message: "Run paused or budget exhausted. Start a smaller new run if the budget is insufficient." } }); return;
    }
    const result = await callOpenAI(settings.key, body);
    const cost = tokenCost(result.inputTokens, result.outputTokens, job);
    await prisma.enrichmentJob.update({ where: { id: job.id }, data: { accountedUsd: { increment: cost - reservation.usd }, inputTokens: { increment: result.inputTokens }, outputTokens: { increment: result.outputTokens } } });
    if (!result.output) throw new EnrichmentError(result.error!);
    await prisma.$transaction(async tx => {
      const book = await tx.book.findUnique({ where: { id: item.bookId }, include: { enrichment: true } });
      if (!book || fingerprint(book) !== inputFingerprint || book.enrichment?.manuallyLocked) {
        await tx.enrichmentJobItem.update({ where: { id: item.id }, data: { status: "skipped", error: "Book changed or was locked while enrichment was running. Result discarded." } }); return;
      }
      await tx.bookEnrichment.upsert({ where: { bookId: book.id }, create: { bookId: book.id }, update: {} });
      const output = result.output!;
      const provenance = { olDescription: source.description };
      const concepts = [];
      for (const concept of output.concepts) {
        const nameKey = conceptKey(concept.name);
        const alias = await tx.conceptAlias.findUnique({ where: { nameKey } });
        const canonical = alias ? null : await tx.concept.findUnique({ where: { nameKey } });
        concepts.push({ originalTerm: concept.name, proposedName: concept.name, conceptId: alias?.conceptId ?? canonical?.id ?? null, weight: concept.salience, perspective: concept.perspective });
      }
      await tx.bookEnrichmentRevision.create({ data: { bookId: book.id, inputFingerprint, inputSnapshot: JSON.stringify(bookInput(book)), generatedOutput: JSON.stringify(output), sourceSnapshot: source.snapshot,
        olWorkId: source.workId, olEditionId: source.editionId, olDescription: source.description, olSourceUrl: source.sourceUrl,
        identityStatus: source.identityStatus, olIdentityStatus: source.identityStatus, modelIdentityStatus: output.identity_match, sourceType: enrichmentSourceType(provenance), knowledgeLevel: output.knowledge_level, overview: output.overview, centralIdea: output.central_idea,
        limitations: `${enrichmentSourceLabel(provenance)} ${output.limitations}`, model: job.model, promptVersion: PROMPT_VERSION, inputTokens: result.inputTokens, outputTokens: result.outputTokens, estimatedCostUsd: cost, concepts: { create: concepts } } });
      await tx.enrichmentJobItem.update({ where: { id: item.id }, data: { status: "needs_review", error: null } });
    });
  } catch (error) {
    const retry = error instanceof EnrichmentError && error.retryable && item.attempts < 2;
    await prisma.enrichmentJobItem.updateMany({ where: { id: item.id }, data: { status: retry ? "queued" : "failed", error: safeError(error), nextAttemptAt: new Date(Date.now() + (error instanceof EnrichmentError ? Math.max(10000, error.retryAfterMs) : 30000)) } });
  }
}
export async function runEnrichmentTick() {
  if (state.busy || databaseRestoreRunning()) return;
  state.busy = true;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  try {
    await prisma.enrichmentWorkerLease.upsert({ where: { id: 1 }, create: { id: 1, token: "", expiresAt: new Date(0) }, update: {} });
    const claimed = await prisma.enrichmentWorkerLease.updateMany({ where: { id: 1, OR: [{ token: state.token }, { expiresAt: { lt: new Date() } }] }, data: { token: state.token, expiresAt: new Date(Date.now() + 180000) } });
    if (!claimed.count) return;
    heartbeat = setInterval(() => { void prisma.enrichmentWorkerLease.updateMany({ where: { id: 1, token: state.token }, data: { expiresAt: new Date(Date.now() + 180000) } }).catch(() => {}); }, 10000);
    if (!state.recovered) {
      await prisma.enrichmentJob.updateMany({ where: { status: "running" }, data: { status: "paused", message: "Interrupted run recovered. Review usage and resume manually; uncertain request reservations were retained." } });
      await prisma.enrichmentJobItem.updateMany({ where: { status: "running" }, data: { status: "queued", error: "Interrupted before completion; review usage before resuming." } });
      state.recovered = true;
    }
    await processNextItem();
    state.warned = false;
  } catch {
    if (!state.warned) console.warn("Catalogue enrichment worker unavailable. Apply the current database schema and check server configuration.");
    state.warned = true;
  } finally { if (heartbeat) clearInterval(heartbeat); state.busy = false; }
}
export function startEnrichmentWorker() {
  if (state.started || process.env.ENRICHMENT_WORKER_ENABLED === "false") return;
  state.started = true;
  const timer = setInterval(() => { void runEnrichmentTick(); }, 3000); timer.unref();
}
