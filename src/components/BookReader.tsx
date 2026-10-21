"use client";
import { useState } from "react";
import Link from "next/link";
import { FIELD_DEFS, bookNumber, type Book } from "@/lib/books";
import Stars from "./Stars";
import BookOverview from "./BookOverview";
import BookEnrichmentPanel from "./BookEnrichmentPanel";
import RelatedBooks from "./RelatedBooks";

const tabs = ["Book details", "Review", "AI insights", "Related books"];
export default function BookReader({ book, returnTo }: { book: Book; returnTo: string }) {
  const [active, setActive] = useState(0);
  return <main className="desktop-book-form mx-auto max-w-7xl px-4 pb-8 md:px-8">
    <header className="book-form-header flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 py-4 dark:border-slate-700"><div><Link href={returnTo} className="text-sm text-slate-500 underline">‹ Back to catalogue</Link><p className="mt-1 font-mono text-xs text-slate-500">{bookNumber(book.id)}</p><h1 className="mt-1 text-2xl font-semibold">{book.title}</h1><p className="mt-1 text-slate-600 dark:text-slate-300">{book.authors}</p></div><Link href={`/books/${book.id}/label`} className="rounded-lg border px-3 py-2 text-sm">Print label</Link></header>
    <nav aria-label="Book sections" className="my-4 overflow-x-auto border-b border-slate-200 dark:border-slate-700"><div role="tablist" aria-label="Book information" className="flex min-w-max">{tabs.map((label, i) => <button key={label} id={`reader-tab-${i}`} role="tab" type="button" aria-selected={active === i} aria-controls={`reader-panel-${i}`} tabIndex={active === i ? 0 : -1} className={`border-b-2 px-4 py-3 text-sm font-medium ${active === i ? "border-teal-700 text-teal-700 dark:border-teal-300 dark:text-teal-300" : "border-transparent text-slate-500"}`} onClick={() => setActive(i)} onKeyDown={event => {
      const next = event.key === "ArrowRight" ? (i + 1) % tabs.length : event.key === "ArrowLeft" ? (i + tabs.length - 1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
      if (next !== null) { event.preventDefault(); setActive(next); document.getElementById(`reader-tab-${next}`)?.focus(); }
    }}>{label}</button>)}</div></nav>
    <div id="reader-panel-0" role="tabpanel" aria-labelledby="reader-tab-0" hidden={active !== 0}>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]"><div className="space-y-4">
        <section className="book-form-card"><h2 className="font-semibold">Book details</h2><p className="mt-2 text-sm text-teal-700 dark:text-teal-300">{[book.bookType || "Unclassified", ...(book.categories || []).map(c => c.name)].join(" · ")}</p>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 xl:grid-cols-3">{FIELD_DEFS.filter(f => !["title", "authors", "rating", "notes", "coverImageUrl", "tags"].includes(f.name) && book[f.name] != null && book[f.name] !== "").map(f => <div key={f.name} className="min-w-0"><dt className="text-xs text-slate-500">{f.label}</dt><dd className="mt-1 break-words text-sm font-medium">{f.name === "ownerId" ? book.owner?.name : String(book[f.name])}</dd></div>)}</dl>
          {book.tags && <p className="mt-4 border-t border-slate-200 pt-3 text-sm dark:border-slate-700"><span className="text-slate-500">Tags: </span>{book.tags}</p>}
        </section>
        {book.notes && <section className="book-form-card"><div className="flex justify-between gap-3"><h2 className="font-semibold">Review</h2><button type="button" className="text-sm text-teal-700 underline dark:text-teal-300" onClick={() => setActive(1)}>Read full review</button></div><p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm leading-relaxed">{book.notes}</p></section>}
      </div><aside aria-label="Book at a glance" className="order-first space-y-4 lg:order-none"><section className="book-form-card"><h2 className="mb-3 font-semibold">Cover &amp; rating</h2><div className="flex items-start gap-5">{book.coverImageUrl && <img src={book.coverImageUrl} alt={`Cover of ${book.title}`} className="max-h-40 max-w-28 rounded object-contain" />}<div><p className="mb-2 text-xs text-slate-500">Rating</p><Stars value={book.rating} />{!book.rating && <p className="mt-1 text-sm text-slate-500">Not rated</p>}</div></div></section><BookOverview bookId={book.id} onOpenInsights={() => setActive(2)} /></aside></div>
    </div>
    <div id="reader-panel-1" role="tabpanel" aria-labelledby="reader-tab-1" hidden={active !== 1} className="book-form-card space-y-3"><h2 className="font-semibold">Review</h2><Stars value={book.rating} /><p className="whitespace-pre-wrap text-sm leading-relaxed">{book.notes || "No review recorded."}</p></div>
    <div id="reader-panel-2" role="tabpanel" aria-labelledby="reader-tab-2" hidden={active !== 2} className="book-enrichment-layout"><BookEnrichmentPanel bookId={book.id} returnTo={returnTo} showRelated={false} /></div>
    <div id="reader-panel-3" role="tabpanel" aria-labelledby="reader-tab-3" hidden={active !== 3} className="book-enrichment-layout"><RelatedBooks bookId={book.id} returnTo={returnTo} /></div>
  </main>;
}
