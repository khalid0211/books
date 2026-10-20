import { authorize, OWNER, currentUser } from "@/lib/auth";
import { parseBookId } from "@/lib/book-id";
import { readEnrichment, reviewEnrichment } from "@/lib/enrichment/service";
import { safeError } from "@/lib/enrichment/core";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(req: Request, { params }: Context) {
  const denied = await authorize(req); if (denied) return denied;
  const id = parseBookId((await params).id); if (!id) return Response.json({ error: "Invalid book number." }, { status: 400 });
  return Response.json(await readEnrichment(id, (await currentUser())?.role === "OWNER"), { headers: { "Cache-Control": "no-store" } });
}
export async function POST(req: Request, { params }: Context) {
  const denied = await authorize(req, OWNER); if (denied) return denied;
  const id = parseBookId((await params).id); if (!id) return Response.json({ error: "Invalid book number." }, { status: 400 });
  try { await reviewEnrichment(id, await req.json()); return Response.json(await readEnrichment(id, true)); }
  catch (error) { return Response.json({ error: safeError(error) }, { status: 400 }); }
}
