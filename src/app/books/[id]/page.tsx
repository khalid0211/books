import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import type { Book } from "@/lib/books";
import BookForm from "@/components/BookForm";
import { requirePage } from "@/lib/auth";
import { FIELD_DEFS, bookNumber } from "@/lib/books";
import Stars from "@/components/Stars";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function EditBookPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage();
  const { id } = await params;
  const numId = Number(id);
  if (!Number.isInteger(numId) || numId <= 0) notFound();

  const row = await prisma.book.findUnique({ where: { id: numId }, include: { owner: { select: { id: true, name: true } } } });
  if (!row) notFound();

  const book: Book = {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };

  if (user.role === "VIEW") return <main className="mx-auto max-w-xl space-y-4 px-4 py-6"><Link href="/" className="underline">‹ Books</Link><p className="text-sm text-slate-500">Book number: <span className="font-mono font-semibold">{bookNumber(book.id)}</span></p><h1 className="text-2xl font-semibold">{book.title}</h1><p>{book.authors}</p><Link href={`/books/${book.id}/label`} className="block underline">Print label</Link><Stars value={book.rating} /><dl className="space-y-3">{FIELD_DEFS.filter((f) => !["title", "authors", "rating"].includes(f.name) && book[f.name] != null && book[f.name] !== "").map((f) => <div key={f.name}><dt className="text-sm text-slate-500">{f.name === "notes" ? "Review" : f.label}</dt><dd className="whitespace-pre-wrap break-words">{f.name === "ownerId" ? book.owner?.name : String(book[f.name])}</dd></div>)}</dl></main>;
  return <BookForm initial={book} canDelete={user.role === "OWNER"} />;
}
