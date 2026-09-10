import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import type { Book } from "@/lib/books";
import BookForm from "@/components/BookForm";

export const dynamic = "force-dynamic";

export default async function EditBookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numId = Number(id);
  if (!Number.isInteger(numId) || numId <= 0) notFound();

  const row = await prisma.book.findUnique({ where: { id: numId } });
  if (!row) notFound();

  const book: Book = {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };

  return <BookForm initial={book} />;
}
