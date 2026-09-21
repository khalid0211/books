import Link from "next/link";
import { requirePage } from "@/lib/auth";
import { parseBookId } from "@/lib/book-id";
import { bookNumber } from "@/lib/books";
import { prisma } from "@/lib/prisma";
import BatchLabels from "@/components/BatchLabels";

export const dynamic = "force-dynamic";
const MAX_LABELS = 100;

type Params = { start?: string; end?: string; ids?: string };

export default async function BatchLabelsPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requirePage();
  const { start = "", end = "", ids = "" } = await searchParams;
  const selectedValues = ids ? ids.split(",").filter(Boolean) : [];
  const selectedIds = [...new Set(selectedValues.map((value) => parseBookId(value)).filter((value): value is number => value !== null))];
  const usingSelection = selectedValues.length > 0;
  const from = parseBookId(start);
  const to = parseBookId(end);
  const requested = usingSelection || Boolean(start || end);
  let error = "";
  if (usingSelection && (selectedIds.length !== selectedValues.length || selectedIds.length > MAX_LABELS)) error = `Choose between 1 and ${MAX_LABELS} valid book numbers.`;
  else if (!usingSelection && requested && (!from || !to)) error = "Enter valid starting and ending book numbers, such as B000123 and B000150.";
  else if (!usingSelection && from && to && to < from) error = "The ending book number must be at least the starting number.";
  else if (!usingSelection && from && to && to - from + 1 > MAX_LABELS) error = `Choose no more than ${MAX_LABELS} book numbers at a time.`;

  const rows = !error && usingSelection ? await prisma.book.findMany({
    where: { id: { in: selectedIds } }, select: { id: true, title: true, owner: { select: { name: true } } }, orderBy: { id: "asc" },
  }) : !error && from && to ? await prisma.book.findMany({
    where: { id: { gte: from, lte: to } }, select: { id: true, title: true, owner: { select: { name: true } } }, orderBy: { id: "asc" },
  }) : [];
  const books = rows.map((row) => ({ id: row.id, title: row.title, owner: row.owner?.name || "Unassigned" }));
  const requestedCount = usingSelection ? selectedIds.length : from && to ? to - from + 1 : 0;
  const missing = !error ? requestedCount - books.length : 0;

  return <main className="batch-label-page mx-auto max-w-4xl space-y-5 px-4 py-6">
    <div className="batch-label-controls space-y-4">
      <Link href="/" className="underline">‹ Back to catalog</Link>
      <h1 className="text-2xl font-semibold">Print book labels</h1>
      {usingSelection ? <p>Review the labels selected from the catalog, then print them in book-number order.</p> : <p>Enter the first and last book number. Each existing book in the range gets one 2″ × 1″ label, in number order.</p>}
      <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <label className="text-sm">Starting book number<input name="start" defaultValue={start} required placeholder="B000123" className="mt-1 block w-40 rounded-lg border border-slate-300 bg-white px-3 py-2 text-base dark:border-slate-700 dark:bg-slate-900" /></label>
        <label className="text-sm">Ending book number<input name="end" defaultValue={end} required placeholder="B000150" className="mt-1 block w-40 rounded-lg border border-slate-300 bg-white px-3 py-2 text-base dark:border-slate-700 dark:bg-slate-900" /></label>
        <button className="rounded-lg bg-teal-700 px-4 py-2 text-white dark:bg-teal-300 dark:text-slate-950">Preview range</button>
      </form>
      {error && <p role="alert" className="text-red-600">{error}</p>}
      {requested && !error && <p role="status">{books.length} label{books.length === 1 ? "" : "s"} found{missing ? `; ${missing} missing book number${missing === 1 ? "" : "s"} skipped` : ""}. {books.length > 0 && `${usingSelection ? "Selection" : "Range"}: ${bookNumber(books[0].id)} to ${bookNumber(books[books.length - 1].id)}.`}</p>}
    </div>
    {books.length > 0 && <BatchLabels books={books} />}
  </main>;
}
