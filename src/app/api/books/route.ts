import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseBookInput, ValidationError } from "@/lib/books";

export const dynamic = "force-dynamic";

// GET /api/books?q=search&sort=title&dir=asc
export async function GET(req: Request) {
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

  const books = await prisma.book.findMany({ where, orderBy });
  return NextResponse.json(books);
}

// POST /api/books
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const data = parseBookInput(body);
    const book = await prisma.book.create({ data });
    return NextResponse.json(book, { status: 201 });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Failed to create book" }, { status: 500 });
  }
}
