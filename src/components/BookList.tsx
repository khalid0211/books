"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Book } from "@/lib/books";
import { pubYear, bookNumber } from "@/lib/books";
import { filterBooks } from "@/lib/book-filters";
import Stars from "@/components/Stars";

export default function BookList({ canEdit = false, canDelete = false }: { canEdit?: boolean; canDelete?: boolean }) {
  const [allBooks, setBooks] = useState<Book[]>([]);
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState("createdAt");
  const [direction, setDirection] = useState("desc");
  const [filters, setFilters] = useState({ bookType: "", category: "", format: "", location: "", rating: "", author: "", language: "", owner: "" });
  const ownerChoices = [...new Map(allBooks.flatMap((b) => b.owner ? [[b.owner.id, b.owner] as const] : [])).values()].sort((a, b) => a.name.localeCompare(b.name));
  const activeFilters = Object.values(filters).filter(Boolean).length;
  const books = useMemo(() => filterBooks(allBooks, query, filters, sort, direction), [allBooks, query, filters, sort, direction]);
  const choices = (field: "format" | "shelfLocation" | "authors" | "language") => [...new Set(allBooks.map((b) => b[field]).filter((v): v is string => Boolean(v)))].sort((a, b) => a.localeCompare(b));
  const selectClass = "mt-1 w-full min-w-0 rounded-lg border border-slate-300 bg-white p-2 text-base dark:border-slate-700 dark:bg-slate-800";
  function reset() { setQuery(""); setFilters({ bookType: "", category: "", format: "", location: "", rating: "", author: "", language: "", owner: "" }); setSort("createdAt"); setDirection("desc"); }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/books", { cache: "no-store" });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      setBooks(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load books");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onDelete(id: number, title: string) {
    if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/books/${id}`, { method: "DELETE" });
    if (res.ok) {
      setBooks((prev) => prev.filter((b) => b.id !== id));
    } else {
      alert("Failed to delete.");
    }
  }

  return (
    <div className="desktop-catalog mx-auto max-w-7xl px-4 pb-24 md:px-8 md:pb-10">
      {/* Sticky header with title + search */}
      <header className="sticky top-0 z-10 -mx-4 mb-4 border-b border-slate-200 bg-slate-50/90 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="w-full md:mr-auto md:w-auto"><p className="mb-1 hidden text-xs font-semibold uppercase tracking-widest text-teal-700 md:block dark:text-teal-300">Your library</p><h1 className="text-xl font-semibold tracking-tight md:text-3xl">Book Catalog</h1></div>
          {canEdit && <Link href="/classify" className="catalog-nav text-sm underline">Classify books</Link>}
          {canEdit && <Link href="/owners" className="catalog-nav text-sm underline">Book owners</Link>}
          {canEdit && <Link href="/locations" className="catalog-nav text-sm underline">Locations</Link>}
          {canEdit && <Link href="/books/move" className="catalog-nav text-sm underline">Move books</Link>}
          <Link href="/books/labels" className="catalog-nav hidden text-sm underline md:inline-block">Print label range</Link>
          {canEdit && <Link
            href="/books/new"
            className="hidden rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800 md:inline-block dark:bg-teal-300 dark:text-slate-950 dark:hover:bg-teal-200"
          >
            + New book
          </Link>}
        </div>
        <div className="mt-2 md:mt-6">
          <input
            type="search"
            aria-label="Search the catalog"
            inputMode="search"
            placeholder="Search book number, title, author, ISBN, tags…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-800"
          />
        </div>
      </header>

      <section aria-label="Sort and filter books" className="catalog-filters mb-4 space-y-3 md:rounded-2xl md:border md:border-slate-200 md:bg-white md:p-5 md:shadow-sm md:dark:border-slate-700 md:dark:bg-slate-800">
        <div className="grid grid-cols-2 gap-3 md:max-w-xl">
          <label className="text-sm">Sort by<select value={sort} onChange={(e) => setSort(e.target.value)} className={selectClass}>
            <option value="createdAt">Date added</option><option value="id">Book number</option><option value="title">Title</option><option value="authors">Author</option><option value="publicationDate">Publication year</option><option value="rating">Rating</option><option value="shelfLocation">Shelf location</option>
          </select></label>
          <label className="text-sm">Order<select value={direction} onChange={(e) => setDirection(e.target.value)} className={selectClass}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label>
        </div>
        <details className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <summary className="cursor-pointer text-sm font-medium">Filters{activeFilters ? ` (${activeFilters})` : ""}</summary>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {([['format', 'Format', 'format'], ['location', 'Shelf location', 'shelfLocation'], ['author', 'Author(s)', 'authors'], ['language', 'Language', 'language']] as const).map(([key, label, field]) => <label key={key} className="text-sm">{label}<select value={filters[key]} onChange={(e) => setFilters((f) => ({ ...f, [key]: e.target.value }))} className={selectClass}><option value="">All</option>{key === 'location' && <option value="__none">Unassigned</option>}{choices(field).map((v) => <option key={v}>{v}</option>)}</select></label>)}
            <label className="text-sm">Book owner<select value={filters.owner} onChange={(e) => setFilters((f) => ({ ...f, owner: e.target.value }))} className={selectClass}><option value="">All owners</option><option value="__none">Unassigned</option>{ownerChoices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
            <label className="text-sm">Type<select value={filters.bookType} onChange={(e) => setFilters((f) => ({ ...f, bookType: e.target.value }))} className={selectClass}><option value="">All types</option><option value="__none">Unclassified</option><option>Fiction</option><option>Non-fiction</option></select></label>
            <label className="text-sm">Category<select value={filters.category} onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))} className={selectClass}><option value="">All categories</option><option value="__none">Unclassified</option>{[...new Map(allBooks.flatMap((b) => (b.categories || []).map((c) => [c.id, c] as const))).values()].sort((a,b) => a.name.localeCompare(b.name)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label className="text-sm">Rating<select value={filters.rating} onChange={(e) => setFilters((f) => ({ ...f, rating: e.target.value }))} className={selectClass}><option value="">All ratings</option><option value="unrated">Not rated</option>{[1,2,3,4,5].map((v) => <option key={v} value={v}>{v} stars and above</option>)}</select></label>
          </div>
        </details>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500">
          <p role="status">{loading ? "Loading..." : `${books.length} of ${allBooks.length} books`}</p>
          <div className="flex items-center gap-2">
            <div role="group" aria-label="Catalog view" className="flex rounded-lg border border-slate-300 p-0.5 dark:border-slate-600">
              {(["cards", "table"] as const).map((mode) => (
                <button key={mode} type="button" aria-pressed={viewMode === mode} onClick={() => setViewMode(mode)} className={`rounded-md px-3 py-1.5 font-medium capitalize ${viewMode === mode ? "bg-teal-700 text-white dark:bg-teal-300 dark:text-slate-950" : "hover:bg-slate-100 dark:hover:bg-slate-700"}`}>
                  {mode}
                </button>
              ))}
            </div>
            <button onClick={reset} className="px-2 py-2 underline">Reset</button>
          </div>
        </div>
      </section>
      {error && (
        <p className="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}

      {loading && books.length === 0 ? (
        <p className="py-10 text-center text-slate-500">Loading…</p>
      ) : books.length === 0 ? (
        <p className="py-10 text-center text-slate-500">
          {query || activeFilters ? "No books match your search and filters." : "No books yet."}
        </p>
      ) : (
        <>
          {viewMode === "table" ? <div className="catalog-table overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <table className="w-full table-fixed text-sm md:table-auto">
              <thead className="bg-slate-100 text-left text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                <tr>
                  <th className="w-20 px-2 py-2 font-medium md:w-auto md:px-3"><span className="md:hidden">Book ID</span><span className="hidden md:inline">Book number</span></th><th className="px-2 py-2 font-medium md:px-3">Title</th>
                  <th className="hidden px-3 py-2 font-medium md:table-cell">Author(s)</th>
                  <th className="hidden px-3 py-2 font-medium md:table-cell">Book owner</th><th className="hidden px-3 py-2 font-medium md:table-cell">Year</th>
                  <th className="hidden px-3 py-2 font-medium md:table-cell">Shelf</th>
                  <th className="hidden px-3 py-2 font-medium md:table-cell">Rating</th>
                  <th className="hidden px-3 py-2 font-medium text-right md:table-cell">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {books.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50"><td className="whitespace-nowrap px-2 py-2 font-mono text-slate-500 md:px-3">{bookNumber(b.id)}</td>
                    <td className="min-w-0 px-2 py-2 md:px-3 md:break-words">
                      <Link href={`/books/${b.id}`} title={b.title} className="block truncate font-medium text-slate-900 hover:underline md:overflow-visible md:text-clip md:whitespace-normal dark:text-slate-100">
                        {b.title}
                      </Link>
                      <p className="mt-1 hidden text-xs text-teal-700 md:block dark:text-teal-300">{[b.bookType, ...(b.categories || []).map((c) => c.name)].filter(Boolean).join(" · ")}</p>
                      {b.format && <p className="mt-1 hidden text-xs capitalize text-slate-500 md:block">{b.format}</p>}
                    </td>
                    <td className="hidden px-3 py-2 text-slate-600 md:table-cell md:break-words dark:text-slate-300">{b.authors || "—"}</td>
                    <td className="hidden px-3 py-2 md:table-cell">{b.owner?.name || "Unassigned"}</td>
                    <td className="hidden px-3 py-2 text-slate-600 md:table-cell dark:text-slate-300">{pubYear(b) || "—"}</td>
                    <td className="hidden px-3 py-2 md:table-cell"><span className="inline-block whitespace-nowrap rounded-md bg-slate-100 px-2 py-1 font-mono text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-300">{b.shelfLocation || "Unassigned"}</span></td>
                    <td className="hidden px-3 py-2 md:table-cell"><Stars value={b.rating} /></td>
                    <td className="hidden px-3 py-2 md:table-cell">
                      <div className="flex justify-end gap-2">
                        <Link href={`/books/${b.id}/label`} className="rounded px-2 py-1 underline">Label</Link>
                        <Link href={`/books/${b.id}`} className="rounded px-2 py-1 text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-teal-800">
                          {canEdit ? "Edit" : "View"}
                        </Link>
                        {canDelete && <button
                          onClick={() => onDelete(b.id, b.title)}
                          className="rounded px-2 py-1 text-red-600 hover:bg-red-100 dark:hover:bg-red-950"
                        >
                          Delete
                        </button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div> : null}

          {viewMode === "cards" ? <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {books.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/books/${b.id}`}
                  className="block h-full w-full rounded-xl border border-slate-200 bg-white p-4 text-left hover:border-teal-600 active:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:active:bg-slate-700"
                >
                  <div className="mb-1 font-mono text-xs text-slate-500">{bookNumber(b.id)}</div><div className="font-semibold">{b.title}</div>
                  <p className="mt-1 text-xs text-teal-700 dark:text-teal-300">{[b.bookType, ...(b.categories || []).map((c) => c.name)].filter(Boolean).join(" · ")}</p><div className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">{b.authors || "Unknown author"}</div><div className="mt-1 text-sm text-slate-500">Owner: {b.owner?.name || "Unassigned"}</div>
                  <div className="mt-2 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    {pubYear(b) && <span>{pubYear(b)}</span>}
                    {b.format && <span className="capitalize">· {b.format}</span>}
                    {b.rating ? <span className="ml-auto"><Stars value={b.rating} /></span> : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul> : null}
        </>
      )}

      {/* Mobile: floating add button */}
      {canEdit && <Link
        href="/books/new"
        aria-label="Add book"
        className="safe-bottom fixed bottom-0 right-4 z-20 mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-teal-700 text-3xl leading-none text-white shadow-lg md:hidden dark:bg-teal-300 dark:text-slate-950"
      >
        +
      </Link>}
    </div>
  );
}

