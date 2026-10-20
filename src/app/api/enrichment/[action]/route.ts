import { authorize, OWNER } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { EnrichmentError, safeError } from "@/lib/enrichment/core";
import { controlJob, createJob, previewRange, saveSettings, settingsPublic, usableSettings } from "@/lib/enrichment/service";
import { approveExistingEnrichments } from "@/lib/enrichment/approval";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ action: string }> };
const headers = { "Cache-Control": "no-store" };
export async function GET(req: Request, { params }: Context) {
  const denied = await authorize(req, OWNER); if (denied) return denied;
  const { action } = await params;
  if (action === "settings") return Response.json(await settingsPublic(), { headers });
  if (action === "jobs") return Response.json(await prisma.enrichmentJob.findMany({ orderBy: { id: "desc" }, take: 10, include: { items: { include: { book: { select: { id: true, title: true } } }, orderBy: { id: "asc" } } } }), { headers });
  return Response.json({ error: "Not found." }, { status: 404 });
}
export async function POST(req: Request, { params }: Context) {
  const denied = await authorize(req, OWNER); if (denied) return denied;
  try {
    const { action } = await params;
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new EnrichmentError("Invalid request.");
    if (action === "settings") return Response.json(await saveSettings(body), { headers });
    if (action === "preview") return Response.json(await previewRange(body), { headers });
    if (action === "jobs") return Response.json(await createJob(body), { status: 201, headers });
    if (action === "approve-existing") return Response.json(await approveExistingEnrichments(100, true), { headers });
    if (action === "control") {
      if (!Number.isSafeInteger(body.id) || body.id < 1) throw new EnrichmentError("Invalid run ID.");
      return Response.json(await controlJob(body.id, body.action), { headers });
    }
    if (action === "test") {
      const s = await usableSettings();
      // Non-generating access test. Actual schema compatibility is checked by the first enrichment.
      const response = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(s.model)}`, { headers: { Authorization: `Bearer ${s.key}` }, signal: AbortSignal.timeout(15000), cache: "no-store" });
      if (!response.ok) throw new EnrichmentError(`OpenAI model access check returned HTTP ${response.status}.`);
      return Response.json({ message: "API key and model access verified. Structured-output compatibility will be checked on the first book." }, { headers });
    }
    return Response.json({ error: "Not found." }, { status: 404 });
  } catch (error) { return Response.json({ error: safeError(error) }, { status: 400, headers }); }
}
