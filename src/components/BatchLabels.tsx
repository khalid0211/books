"use client";

import { useEffect, useState } from "react";
import { bookNumber } from "@/lib/books";
import { renderBookLabel } from "@/lib/render-book-label";

type LabelBook = { id: number; title: string; owner: string };

export default function BatchLabels({ books }: { books: LabelBook[] }) {
  const [labels, setLabels] = useState<{ id: number; title: string; url: string; shortened: boolean }[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      setError("");
      setLabels(books.map((book) => ({ id: book.id, title: book.title, ...renderBookLabel(book.id, book.title, book.owner) })));
    } catch {
      setLabels([]);
      setError("Could not prepare the labels. Reload to try again.");
    }
  }, [books]);

  return <>
    <div className="batch-label-controls space-y-3">
      {error && <p role="alert" className="text-red-600">{error}</p>}
      {labels.some((label) => label.shortened) && <p role="status">Some long text was shortened. Check the previews before printing.</p>}
      <button disabled={labels.length !== books.length} onClick={() => window.print()} className="rounded-lg bg-teal-700 px-4 py-3 text-white disabled:opacity-50 dark:bg-teal-300 dark:text-slate-950">Print {books.length} labels</button>
      <p className="text-sm">On the PC, select 2″ × 1″ (50.8 × 25.4 mm) label paper, no margins, 100% scale, and turn off headers and footers. Print one test label to check alignment.</p>
    </div>
    <div className="batch-label-list grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {labels.map((label) => <div key={label.id} className="batch-label-item">
        <p className="batch-label-controls mb-1 text-sm font-medium">{bookNumber(label.id)} · {label.title}</p>
        <img src={label.url} width={600} height={300} alt={`Label for ${bookNumber(label.id)}: ${label.title}`} className="batch-label-image w-full border border-slate-300" />
      </div>)}
    </div>
    <style>{`@media print {
      @page { size: 50.8mm 25.4mm; margin: 0; }
      html, body { width: 50.8mm !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; background: white !important; }
      body > :not(.batch-label-page) { display: none !important; }
      .batch-label-page { display: block !important; width: 50.8mm !important; max-width: none !important; margin: 0 !important; padding: 0 !important; }
      .batch-label-controls { display: none !important; }
      .batch-label-list { display: block !important; margin: 0 !important; padding: 0 !important; }
      .batch-label-item { display: block !important; width: 50.8mm !important; height: 25.4mm !important; margin: 0 !important; padding: 0 !important; overflow: hidden; break-after: page; page-break-after: always; }
      .batch-label-item:last-child { break-after: auto; page-break-after: auto; }
      .batch-label-image { display: block !important; width: 50.8mm !important; height: 25.4mm !important; max-width: none !important; border: 0 !important; margin: 0 !important; print-color-adjust: exact; }
    }`}</style>
  </>;
}
