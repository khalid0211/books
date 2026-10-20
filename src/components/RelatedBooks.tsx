"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { RelatedResult } from "@/lib/enrichment/related";
import { bookNumber } from "@/lib/books";
export default function RelatedBooks({ bookId, returnTo = "/" }: { bookId: number; returnTo?: string }) {
  const [books, setBooks] = useState<RelatedResult[] | null>(null), [error, setError] = useState("");
  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const r = await fetch(`/api/books/${bookId}/related`, { cache: "no-store" });
        if (!r.ok) throw new Error("Could not load related books.");
        const data = await r.json(); if (mounted) { setBooks(data.books); setError(""); }
      } catch (e) { if (mounted) setError(e instanceof Error ? e.message : "Could not load related books."); }
    }
    void load(); window.addEventListener("enrichment-updated", load); window.addEventListener("focus", load);
    return () => { mounted = false; window.removeEventListener("enrichment-updated", load); window.removeEventListener("focus", load); };
  }, [bookId]);
  return <section className="space-y-4 rounded-xl border p-4"><h2 className="text-xl font-semibold">Related books in your library</h2>
    <p className="text-sm text-slate-500">Connections come from shared AI-derived concepts. They indicate related topics, not necessarily agreement between the authors.</p>
    {error ? <p role="alert">{error}</p> : !books ? <p>Finding related books…</p> : books.length === 0 ? <p>No strong matches identified yet. More approved enrichments can help reveal connections.</p> : <ul className="space-y-4">{books.map(book => <li key={book.id} className="space-y-2 rounded-lg border p-3">
      <Link href={`/books/${book.id}?returnTo=${encodeURIComponent(returnTo)}`} className="font-semibold underline">{book.title}</Link><p className="text-sm">{book.authors} · {bookNumber(book.id)}</p><p>{book.explanation}</p>
      <div className="flex flex-wrap gap-2">{book.sharedConcepts.map(c => <span key={c.id} className="rounded-full bg-teal-100 px-3 py-1 text-sm text-teal-950">{c.name}</span>)}</div>
      {book.sharedConcepts.some(c => c.sourcePerspective || c.relatedPerspective) && <details><summary className="cursor-pointer text-sm underline">Compare perspectives · AI-derived</summary><dl className="mt-2 space-y-3 text-sm">{book.sharedConcepts.map(c => <div key={c.id}><dt className="font-semibold">{c.name}</dt>{c.sourcePerspective && <dd>This book: {c.sourcePerspective}</dd>}{c.relatedPerspective && <dd>{book.title}: {c.relatedPerspective}</dd>}</div>)}</dl></details>}
    </li>)}</ul>}
  </section>;
}
