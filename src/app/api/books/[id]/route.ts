import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseBookInput, ValidationError } from "@/lib/books";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function getId(ctx: Ctx): Promise<number | null> {
  const { id } = await ctx.params;
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// GET /api/books/:id
export async function GET(_req: Request, ctx: Ctx) {
  const id = await getId(ctx);
  if (id === null) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const book = await prisma.book.findUnique({ where: { id } });
  if (!book) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(book);
}

// PUT /api/books/:id
export async function PUT(req: Request, ctx: Ctx) {
  const id = await getId(ctx);
  if (id === null) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const data = parseBookInput(body);
    const book = await prisma.book.update({ where: { id }, data });
    return NextResponse.json(book);
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    console.error(err);
    return NextResponse.json({ error: "Failed to update book" }, { status: 500 });
  }
}

// DELETE /api/books/:id
export async function DELETE(_req: Request, ctx: Ctx) {
  const id = await getId(ctx);
  if (id === null) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  try {
    await prisma.book.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    console.error(err);
    return NextResponse.json({ error: "Failed to delete book" }, { status: 500 });
  }
}
