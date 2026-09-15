"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { bookNumber, type Book } from "@/lib/books";
import { suggestClassification, type CategoryChoice, type Classification } from "@/lib/classification";
import ClassificationPicker from "./ClassificationPicker";

export default function ClassifyBooks() {
  const [books, setBooks] = useState<Book[]>([]);
  const [categories, setCategories] = useState<CategoryChoice[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [choice, setChoice] = useState<Classification>({ bookType: null, categoryIds: [] });
  const [suggestions, setSuggestions] = useState<Record<number, { value: Classification; source: string }>>({});
  const [query, setQuery] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function load() {
    const [a, b] = await Promise.all([fetch("/api/books", { cache: "no-store" }), fetch("/api/categories", { cache: "no-store" })]);
    if (!a.ok || !b.ok) throw new Error("Could not load books and categories. Reload to try again.");
    setBooks(await a.json()); setCategories(await b.json());
  }
  useEffect(() => { load().catch((e) => setError(e.message)).finally(() => setBusy(false)); }, []);
  const visible = books.filter((b) => (!onlyMissing || !b.bookType || !b.categories?.length) && `${bookNumber(b.id)} ${b.title} ${b.authors}`.toLowerCase().includes(query.toLowerCase()));
  async function lookup(book: Book) {
    setBusy(true); setError(""); setMessage("");
    try {
      const res = await fetch(`/api/lookup?isbn=${encodeURIComponent(book.isbn13 || book.isbn10 || "")}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lookup failed.");
      setSuggestions((prev) => ({ ...prev, [book.id]: { value: suggestClassification(data.subjects || (data.tags || "").split(","), categories), source: (data.sources || []).join(" + ") || "Book lookup" } }));
    } catch (e) { setError(e instanceof Error ? e.message : "Lookup failed."); }
    finally { setBusy(false); }
  }
  async function save(ids: number[], value: Classification) {
    setBusy(true); setError(""); setMessage("");
    try {
      const res = await fetch("/api/classification", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookIds: ids, ...value }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save classification.");
      await load(); setSelected([]); setMessage(`${data.updated} books updated. ${data.skipped} unchanged. Existing classifications were kept.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save classification."); }
    finally { setBusy(false); }
  }
  return <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 md:px-8">
    <div className="flex flex-wrap items-center justify-between gap-3"><Link href="/" className="underline">‹ Catalog</Link><Link href="/categories" className="underline">Manage categories</Link></div>
    <h1 className="text-3xl font-semibold">Classify books</h1><p className="text-sm text-slate-500">Review suggestions individually, or select up to 100 books and apply a shared classification. Only empty type and category fields are filled. Use Edit on a book to change existing choices.</p>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}
    {message && <p role="status" className="rounded-xl bg-teal-50 p-4 text-teal-900 dark:bg-teal-950 dark:text-teal-100">{message}</p>}
    <div className="grid items-start gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="space-y-4 lg:sticky lg:top-5"><ClassificationPicker categories={categories} value={choice} onChange={setChoice} disabled={busy} /><button disabled={busy || !selected.length || (!choice.bookType && !choice.categoryIds.length)} onClick={() => void save(selected, choice)} className="app-primary w-full rounded-xl p-3 disabled:opacity-50">{busy ? "Please wait…" : `Apply to ${selected.length} selected books`}</button><button disabled={busy || !selected.length} onClick={() => setSelected([])} className="text-sm underline disabled:opacity-50">Clear selection</button></aside>
      <section className="min-w-0 space-y-4" aria-label="Books to classify">
        <input type="search" aria-label="Search books to classify" placeholder="Search book ID, title, or author…" value={query} onChange={(e) => { setQuery(e.target.value); setSelected([]); }} disabled={busy} className="w-full rounded-xl border bg-white p-3 dark:bg-slate-800" />
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm"><label><input type="checkbox" checked={onlyMissing} disabled={busy} onChange={(e) => { setOnlyMissing(e.target.checked); setSelected([]); }} className="mr-2" />Missing type or categories only</label><button disabled={busy || !visible.length} onClick={() => setSelected(visible.slice(0, 100).map((b) => b.id))} className="underline">Select first {Math.min(100, visible.length)}</button></div>
        <p className="text-sm text-slate-500">{busy ? "Working…" : `${visible.length} books`}</p>
        {!busy && !visible.length && <p>No books match this view.</p>}
        <ul className="space-y-3">{visible.map((book) => {
          const suggestion = suggestions[book.id] || { value: suggestClassification((book.tags || "").split(","), categories), source: "Saved tags" };
          const labels = [suggestion.value.bookType, ...categories.filter((c) => suggestion.value.categoryIds.includes(c.id)).map((c) => c.name)].filter(Boolean);
          const useful = (!book.bookType && suggestion.value.bookType) || (!book.categories?.length && suggestion.value.categoryIds.length);
          return <li key={book.id} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
            <div className="flex items-start gap-3"><input type="checkbox" aria-label={`Select ${bookNumber(book.id)} ${book.title}`} checked={selected.includes(book.id)} disabled={busy || (!selected.includes(book.id) && selected.length >= 100)} onChange={(e) => setSelected((ids) => e.target.checked ? [...ids, book.id] : ids.filter((id) => id !== book.id))} className="mt-1" /><div className="min-w-0 flex-1"><p className="text-xs text-slate-500">{bookNumber(book.id)}</p><Link href={`/books/${book.id}`} className="font-semibold hover:underline">{book.title}</Link><p className="text-sm text-slate-500">{book.authors}</p><p className="mt-1 text-sm">{book.bookType || "Type unclassified"} · {book.categories?.map((c) => c.name).join(", ") || "No categories"}</p></div><Link href={`/books/${book.id}`} className="text-sm underline">Edit</Link></div>
            <div className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-900"><p className="text-xs text-slate-500">Suggestion · {suggestion.source}</p><p className="mt-1">{labels.join(" · ") || "No matching suggestion. Choose categories manually."}</p><div className="mt-2 flex flex-wrap gap-3">{useful ? <button disabled={busy} onClick={() => void save([book.id], suggestion.value)} className="font-medium text-teal-700 underline disabled:opacity-50 dark:text-teal-300">Accept suggestion</button> : null}<button disabled={busy || !(book.isbn13 || book.isbn10)} onClick={() => void lookup(book)} className="underline disabled:opacity-50">Look up ISBN</button></div></div>
          </li>;
        })}</ul>
      </section>
    </div>
  </main>;
}
