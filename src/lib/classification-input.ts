import { prisma } from "@/lib/prisma";
import { BOOK_TYPES } from "@/lib/classification";
import { ValidationError } from "@/lib/books";

export async function classificationInput(body: unknown) {
  const b = body as Record<string, unknown> | null;
  if (!b || (!Object.hasOwn(b, "bookType") && !Object.hasOwn(b, "categoryIds"))) return {};
  const data: { bookType?: string | null; categories?: { set: { id: number }[] } } = {};
  if (Object.hasOwn(b, "bookType")) {
    if (b.bookType !== null && !BOOK_TYPES.includes(b.bookType as string)) throw new ValidationError("Choose Fiction, Non-fiction, or Unclassified.");
    data.bookType = b.bookType as string | null;
  }
  if (Object.hasOwn(b, "categoryIds")) {
    if (!Array.isArray(b.categoryIds) || b.categoryIds.length > 50 || b.categoryIds.some((id) => !Number.isSafeInteger(id) || id < 1)) throw new ValidationError("Select valid categories.");
    const ids = [...new Set(b.categoryIds as number[])];
    if (await prisma.category.count({ where: { id: { in: ids } } }) !== ids.length) throw new ValidationError("A category no longer exists. Reload and choose again.");
    data.categories = { set: ids.map((id) => ({ id })) };
  }
  return data;
}
