import { authorize } from "@/lib/auth";
import { parseBookId } from "@/lib/book-id";
import { prisma } from "@/lib/prisma";
import { relatedBooks } from "@/lib/enrichment/related";
export const dynamic = "force-dynamic";
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await authorize(req); if (denied) return denied;
  const id = parseBookId((await params).id);
  if (!id) return Response.json({ error: "Invalid book number." }, { status: 400 });
  const rawLimit = new URL(req.url).searchParams.get("limit");
  const limit = rawLimit === null ? 5 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 5) return Response.json({ error: "Choose a limit from 1 to 5." }, { status: 400 });
  if (!await prisma.book.findUnique({ where: { id }, select: { id: true } })) return Response.json({ error: "Book not found." }, { status: 404 });
  return Response.json(await relatedBooks(id, limit), { headers: { "Cache-Control": "no-store" } });
}
