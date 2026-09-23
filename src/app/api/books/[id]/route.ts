import { classificationInput } from "@/lib/classification-input";
import { authorize, READ, WRITE, OWNER } from "@/lib/auth";
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
export async function GET(req: Request, ctx: Ctx) {
  const denied = await authorize(req, READ); if (denied) return denied;
  const id = await getId(ctx);
  if (id === null) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const book = await prisma.book.findUnique({ where: { id }, include: { categories: { select: { id: true, name: true } }, owner: { select: { id: true, name: true } } } });
  if (!book) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(book);
}

// PUT /api/books/:id
export async function PUT(req: Request, ctx: Ctx) {
  const denied = await authorize(req, WRITE); if (denied) return denied;
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
    const classification = await classificationInput(body);
    if (data.ownerId !== null && !await prisma.bookOwner.findUnique({ where: { id: data.ownerId } })) throw new ValidationError("Selected book owner no longer exists. Reload and choose an owner.");
    const book = await prisma.book.update({ where: { id }, data: { ...data, ...classification } });
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
export async function DELETE(req: Request, ctx: Ctx) {
  const denied = await authorize(req, OWNER); if (denied) return denied;
  const id = await getId(ctx);
  if (id === null) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  try {
    await prisma.book.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
      return NextResponse.json({ error: "This book has borrowing history and cannot be deleted." }, { status: 409 });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    console.error(err);
    return NextResponse.json({ error: "Failed to delete book" }, { status: 500 });
  }
}
