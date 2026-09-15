import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import BookLabel from "@/components/BookLabel";

export default async function LabelPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePage();
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) notFound();
  const book = await prisma.book.findUnique({ where: { id }, include: { owner: true } });
  if (!book) notFound();
  return <BookLabel id={book.id} title={book.title} owner={book.owner?.name || "Unassigned"} location={book.shelfLocation || "Unassigned"} />;
}
