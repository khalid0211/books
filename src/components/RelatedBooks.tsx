"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { RelatedResult } from "@/lib/enrichment/related";
import { bookNumber } from "@/lib/books";
export default function RelatedBooks({ bookId, returnTo = "/" }: { bookId: number; returnTo?: string }) {
  const [books, setBooks] = useState<RelatedResult[] | null>(null), [error, setError] = useState("");
  const [diagnostics, setDiagnostics] = useState<{ eligibleWorks: number; sourceStatus: string; comparedWorks: number } | null>(null);
  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const r = await fetch(`/api/books/${bookId}/related`, { cache: "no-store" });
        if (!r.ok) throw new Error("Could not load related books.");
        const data = await r.json(); if (mounted) { setBooks(data.books); setDiagnostics({ eligibleWorks: data.eligibleWorks, sourceStatus: data.sourceStatus || "ready", comparedWorks: data.comparedWorks ?? Math.max(0, data.eligibleWorks - 1) }); setError(""); }
      } catch (e) { if (mounted) setError(e instanceof Error ? e.message : "Could not load related books."); }
    }
    void load(); window.addEventListener("enrichment-updated", load); window.addEventListener("focus", load);
    return () => { mounted = false; window.removeEventListener("enrichment-updated", load); window.removeEventListener("focus", load); };
  }, [bookId]);
  return <section className="space-y-4 rounded-xl border p-4"><h2 className="text-xl font-semibold">Related books in your library</h2>
    <p className="text-sm text-slate-500">Connections come from shared AI-derived concepts and related topic wording. They indicate related topics, not necessarily agreement between the authors.</p>
    {diagnostics && <p className="text-sm text-slate-500">{diagnostics.eligibleWorks} distinct works with current approved enrichment available for matching.</p>}
    {error ? <p role="alert">{error}</p> : !books ? <p>Finding related books…</p> : books.length === 0 ? <p role="status">{diagnostics?.sourceStatus === "not_enriched" ? "This book has not been enriched yet. Enrich and approve it before finding related books." : diagnostics?.sourceStatus === "unpublished" ? "This book has no published enrichment. Its enrichment must be approved and published before it can be matched." : diagnostics?.sourceStatus === "stale" ? "This book’s title, author or edition details changed after enrichment. Regenerate its enrichment before matching." : diagnostics?.sourceStatus === "no_concepts" || diagnostics?.sourceStatus === "unavailable" ? "This book has no usable approved concepts in its current publication. Check its AI insights." : diagnostics && diagnostics.comparedWorks < 1 ? "No other distinct works have current approved enrichment to compare with yet." : `No sufficiently strong topic overlap found${diagnostics ? ` among ${diagnostics.comparedWorks} other distinct works` : ""}.`}</p> : <ul className="space-y-4">{books.map(book => <li key={book.id} className="space-y-2 rounded-lg border p-3">
      <Link href={`/books/${book.id}?returnTo=${encodeURIComponent(returnTo)}`} className="font-semibold underline">{book.title}</Link><p className="text-sm">{book.authors} · {bookNumber(book.id)}</p><p>{book.explanation}</p>
      {book.matchedTerms && <div className="flex flex-wrap gap-2">{book.matchedTerms.map(term => <span key={term} className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-800 dark:bg-slate-700 dark:text-slate-100">{term}</span>)}</div>}
      <div className="flex flex-wrap gap-2">{book.sharedConcepts.map(c => <span key={c.id} className="rounded-full bg-teal-100 px-3 py-1 text-sm text-teal-950">{c.name}</span>)}</div>
      {book.sharedConcepts.some(c => c.sourcePerspective || c.relatedPerspective) && <details><summary className="cursor-pointer text-sm underline">Compare perspectives · AI-derived</summary><dl className="mt-2 space-y-3 text-sm">{book.sharedConcepts.map(c => <div key={c.id}><dt className="font-semibold">{c.name}</dt>{c.sourcePerspective && <dd>This book: {c.sourcePerspective}</dd>}{c.relatedPerspective && <dd>{book.title}: {c.relatedPerspective}</dd>}</div>)}</dl></details>}
    </li>)}</ul>}
  </section>;
}
