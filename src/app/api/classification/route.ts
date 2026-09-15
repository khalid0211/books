import { NextResponse } from "next/server";
import { authorize, WRITE } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { classificationInput } from "@/lib/classification-input";
import { ValidationError } from "@/lib/books";

export async function POST(req: Request) {
  const denied = await authorize(req, WRITE); if (denied) return denied;
  const body = await req.json().catch(() => null);
  if (!Array.isArray(body?.bookIds) || !body.bookIds.length || body.bookIds.length > 100 || body.bookIds.some((id: unknown) => !Number.isSafeInteger(id) || Number(id) < 1)) return NextResponse.json({ error: "Select between 1 and 100 books." }, { status: 400 });
  try {
    const classification = await classificationInput(body);
    if (!classification.bookType && !classification.categories?.set.length) throw new ValidationError("Choose a type or at least one category.");
    const ids = [...new Set<number>(body.bookIds)];
    const updated = await prisma.$transaction(async (tx) => {
      const books = await tx.book.findMany({ where: { id: { in: ids } }, include: { categories: true } });
      if (books.length !== ids.length) throw new ValidationError("A selected book no longer exists. Reload and try again.");
      let count = 0;
      for (const book of books) {
        const bookType = !book.bookType && classification.bookType ? classification.bookType : undefined;
        const categories = !book.categories.length && classification.categories?.set.length ? classification.categories : undefined;
        if (bookType || categories) {
          await tx.book.update({ where: { id: book.id }, data: { bookType, categories } });
          count++;
        }
      }
      return count;
    });
    return NextResponse.json({ updated, skipped: ids.length - updated });
  } catch (e) {
    return NextResponse.json({ error: e instanceof ValidationError ? e.message : "Could not save classification. Reload before retrying." }, { status: e instanceof ValidationError ? 400 : 500 });
  }
}
