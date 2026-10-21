import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import type { Book } from "@/lib/books";
import BookForm from "@/components/BookForm";
import { requirePage } from "@/lib/auth";
import BookReader from "@/components/BookReader";
import { safeCatalogueReturn } from "@/lib/catalogue-state";

export const dynamic = "force-dynamic";

export default async function EditBookPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ returnTo?: string }> }) {
  const user = await requirePage();
  const { id } = await params;
  const returnTo = safeCatalogueReturn((await searchParams).returnTo);
  const numId = Number(id);
  if (!Number.isInteger(numId) || numId <= 0) notFound();

  const row = await prisma.book.findUnique({ where: { id: numId }, include: { categories: { select: { id: true, name: true } }, owner: { select: { id: true, name: true } } } });
  if (!row) notFound();

  const book: Book = {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };

  if (user.role === "VIEW") return <BookReader book={book} returnTo={returnTo} />;
  return <BookForm initial={book} canDelete={user.role === "OWNER"} returnTo={returnTo} />;
}
