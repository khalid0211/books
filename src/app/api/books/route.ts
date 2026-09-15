import { classificationInput } from "@/lib/classification-input";
import { authorize, READ, WRITE, OWNER } from "@/lib/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseBookInput, ValidationError } from "@/lib/books";

export const dynamic = "force-dynamic";

// GET /api/books?q=search&sort=title&dir=asc
export async function GET(req: Request) {
  const denied = await authorize(req, READ); if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  const sort = searchParams.get("sort") ?? "createdAt";
  const dir = searchParams.get("dir") === "asc" ? "asc" : "desc";

  const allowedSort = ["title", "authors", "publicationDate", "rating", "createdAt", "updatedAt"];
  const orderBy = { [allowedSort.includes(sort) ? sort : "createdAt"]: dir } as Record<string, "asc" | "desc">;

  const where = q
    ? {
        OR: [
          { title: { contains: q } },
          { authors: { contains: q } },
          { publisher: { contains: q } },
          { tags: { contains: q } },
          { isbn13: { contains: q } },
          { isbn10: { contains: q } },
        ],
      }
    : undefined;

  const books = await prisma.book.findMany({ where, orderBy, include: { categories: { select: { id: true, name: true } }, owner: { select: { id: true, name: true } } } });
  return NextResponse.json(books);
}

// POST /api/books
export async function POST(req: Request) {
  const denied = await authorize(req, WRITE); if (denied) return denied;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const data = parseBookInput(body);
    const classification = await classificationInput(body);
    if (data.ownerId !== null && !await prisma.bookOwner.findUnique({ where: { id: data.ownerId } })) throw new ValidationError("Selected book owner no longer exists. Reload and choose an owner.");
    const book = await prisma.book.create({ data: { ...data, bookType: classification.bookType, categories: classification.categories ? { connect: classification.categories.set } : undefined } });
    return NextResponse.json(book, { status: 201 });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Failed to create book" }, { status: 500 });
  }
}
