"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Book } from "@/lib/books";
import { pubYear, bookNumber } from "@/lib/books";
import { filterBooks } from "@/lib/book-filters";
import Stars from "@/components/Stars";

const EMPTY_FILTERS = { bookType: "", category: "", format: "", location: "", rating: "", author: "", language: "", owner: "" };

export default function BookList({ canEdit = false, canDelete = false }: { canEdit?: boolean; canDelete?: boolean }) {
  const [allBooks, setBooks] = useState<Book[]>([]);
  const [viewMode, setViewMode] = useState<"cards" | "table">("table");
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState("createdAt");
  const [direction, setDirection] = useState("desc");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const ownerChoices = [...new Map(allBooks.flatMap((book) => book.owner ? [[book.owner.id, book.owner] as const] : [])).values()].sort((a, b) => a.name.localeCompare(b.name));
  const activeFilters = Object.values(filters).filter(Boolean).length;
  const books = useMemo(() => filterBooks(allBooks, query, filters, sort, direction), [allBooks, query, filters, sort, direction]);
  const choices = (field: "format" | "shelfLocation" | "authors" | "language") => [...new Set(allBooks.map((book) => book[field]).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b));
  const selectClass = "mt-1 w-full min-w-0 rounded-lg border border-slate-300 bg-white p-2 text-base dark:border-slate-600 dark:bg-slate-900";
  const unclassified = allBooks.filter((book) => !book.bookType && !book.categories?.length).length;
  const withoutLocation = allBooks.filter((book) => !book.shelfLocation).length;
  const withoutOwner = allBooks.filter((book) => !book.ownerId).length;
  const visibleIds = books.map((book) => book.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const selectedIds = [...selected].sort((a, b) => a - b);

  function reset() { setQuery(""); setFilters(EMPTY_FILTERS); setSort("createdAt"); setDirection("desc"); }
  function showSummary(kind: "all" | "classification" | "location" | "owner" | "recent") {
    setQuery(""); setFilters(EMPTY_FILTERS);
    if (kind === "classification") setFilters({ ...EMPTY_FILTERS, bookType: "__none", category: "__none" });
    if (kind === "location") setFilters({ ...EMPTY_FILTERS, location: "__none" });
    if (kind === "owner") setFilters({ ...EMPTY_FILTERS, owner: "__none" });
    if (kind === "recent") { setSort("createdAt"); setDirection("desc"); }
  }
  function toggle(id: number) {
    setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  function toggleVisible() {
    setSelected((current) => {
      const next = new Set(current);
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id)); else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  }

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const response = await fetch("/api/books", { cache: "no-store" });
      if (!response.ok) throw new Error(`Request failed (${response.status})`);
      setBooks(await response.json());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load books");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function onDelete(id: number, title: string) {
    if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;
    const response = await fetch(`/api/books/${id}`, { method: "DELETE" });
    if (response.ok) {
      setBooks((current) => current.filter((book) => book.id !== id));
      setSelected((current) => { const next = new Set(current); next.delete(id); return next; });
    } else { const data = await response.json().catch(() => ({})); alert(data.error || "Failed to delete."); }
  }

  const summaries = [
    { label: "Total books", value: allBooks.length, kind: "all" as const, note: "Complete collection" },
    { label: "Unclassified", value: unclassified, kind: "classification" as const, note: "Missing type and category" },
    { label: "Without location", value: withoutLocation, kind: "location" as const, note: "Needs a shelf" },
    { label: "Without owner", value: withoutOwner, kind: "owner" as const, note: "Ownership unassigned" },
  ];

  return <div className="desktop-catalog mx-auto max-w-[1500px] px-4 pb-24 md:px-7 md:pb-10 lg:px-10">
    <header className="sticky top-0 z-10 -mx-4 mb-4 border-b border-slate-200 bg-slate-50/90 px-4 py-3 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:px-0 md:pb-2 md:pt-3 md:backdrop-blur-none dark:border-slate-800 dark:bg-slate-900/90 md:dark:bg-transparent">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="w-full md:w-auto"><p className="mb-1 hidden text-xs font-semibold uppercase tracking-[.16em] text-teal-700 md:block dark:text-teal-300">Collection workspace</p><h1 className="text-xl font-semibold tracking-tight md:text-3xl">Book Catalog</h1><p className="mt-1 hidden text-sm text-slate-500 md:block">Search, organize, and maintain your personal library.</p></div>
        <div className="flex flex-wrap items-center gap-3 md:hidden">
          {canEdit && <Link href="/loans" className="text-sm underline">Borrowing & returns</Link>}
          {canEdit && <Link href="/classify" className="text-sm underline">Classify books</Link>}
          {canEdit && <Link href="/owners" className="text-sm underline">Book owners</Link>}
          {canEdit && <Link href="/locations" className="text-sm underline">Locations</Link>}
          {canEdit && <Link href="/books/move" className="text-sm underline">Move books</Link>}
        </div>
        {canEdit && <Link href="/books/new" className="hidden rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-teal-800 md:inline-block dark:bg-teal-300 dark:text-slate-950">+ Add book</Link>}
      </div>
    </header>

    <section aria-label="Catalog summary" className="mb-5 hidden grid-cols-2 gap-3 md:grid xl:grid-cols-4">
      {summaries.map((summary) => <button key={summary.label} onClick={() => showSummary(summary.kind)} className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-teal-500 hover:shadow-md dark:border-slate-700 dark:bg-slate-800">
        <span className="block text-2xl font-semibold tracking-tight">{loading ? "—" : summary.value}</span>
        <span className="mt-1 block text-sm font-semibold">{summary.label}</span>
        <span className="mt-1 block text-xs text-slate-500">{summary.note}</span>
      </button>)}
    </section>

    <section aria-label="Search, sort, and filter books" className="catalog-filters mb-4 space-y-4 md:rounded-2xl md:border md:border-slate-200 md:bg-white md:p-5 md:shadow-sm md:dark:border-slate-700 md:dark:bg-slate-800">
      <div className="grid gap-3 md:grid-cols-[minmax(260px,1fr)_180px_145px] md:items-end">
        <label className="text-sm font-medium"><span className="hidden md:inline">Search catalog</span><input type="search" aria-label="Search the catalog" inputMode="search" placeholder="Search number, title, author, ISBN, tags…" value={query} onChange={(event) => setQuery(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base outline-none focus:border-teal-600 dark:border-slate-600 dark:bg-slate-900" /></label>
        <label className="text-sm">Sort by<select value={sort} onChange={(event) => setSort(event.target.value)} className={selectClass}><option value="createdAt">Date added</option><option value="id">Book number</option><option value="title">Title</option><option value="authors">Author</option><option value="publicationDate">Publication year</option><option value="rating">Rating</option><option value="shelfLocation">Shelf location</option></select></label>
        <label className="text-sm">Order<select value={direction} onChange={(event) => setDirection(event.target.value)} className={selectClass}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label>
      </div>
      <details className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <summary className="cursor-pointer text-sm font-medium">Filters{activeFilters ? ` (${activeFilters} active)` : ""}</summary>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {([['format', 'Format', 'format'], ['location', 'Shelf location', 'shelfLocation'], ['author', 'Author(s)', 'authors'], ['language', 'Language', 'language']] as const).map(([key, label, field]) => <label key={key} className="text-sm">{label}<select value={filters[key]} onChange={(event) => setFilters((current) => ({ ...current, [key]: event.target.value }))} className={selectClass}><option value="">All</option>{key === "location" && <option value="__none">Unassigned</option>}{choices(field).map((value) => <option key={value}>{value}</option>)}</select></label>)}
          <label className="text-sm">Book owner<select value={filters.owner} onChange={(event) => setFilters((current) => ({ ...current, owner: event.target.value }))} className={selectClass}><option value="">All owners</option><option value="__none">Unassigned</option>{ownerChoices.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}</select></label>
          <label className="text-sm">Type<select value={filters.bookType} onChange={(event) => setFilters((current) => ({ ...current, bookType: event.target.value }))} className={selectClass}><option value="">All types</option><option value="__none">Unclassified</option><option>Fiction</option><option>Non-fiction</option></select></label>
          <label className="text-sm">Category<select value={filters.category} onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value }))} className={selectClass}><option value="">All categories</option><option value="__none">Unclassified</option>{[...new Map(allBooks.flatMap((book) => (book.categories || []).map((category) => [category.id, category] as const))).values()].sort((a, b) => a.name.localeCompare(b.name)).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <label className="text-sm">Rating<select value={filters.rating} onChange={(event) => setFilters((current) => ({ ...current, rating: event.target.value }))} className={selectClass}><option value="">All ratings</option><option value="unrated">Not rated</option>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} stars and above</option>)}</select></label>
        </div>
      </details>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
        <p role="status">{loading ? "Loading…" : `${books.length} of ${allBooks.length} books`}</p>
        <div className="flex items-center gap-2">
          <div role="group" aria-label="Catalog view" className="hidden rounded-lg border border-slate-300 p-0.5 md:flex dark:border-slate-600">{(["table", "cards"] as const).map((mode) => <button key={mode} type="button" aria-pressed={viewMode === mode} onClick={() => setViewMode(mode)} className={`rounded-md px-3 py-1.5 font-medium capitalize ${viewMode === mode ? "bg-teal-700 text-white dark:bg-teal-300 dark:text-slate-950" : "hover:bg-slate-100 dark:hover:bg-slate-700"}`}>{mode}</button>)}</div>
          {viewMode === "table" && <button onClick={() => setDensity((value) => value === "compact" ? "comfortable" : "compact")} className="hidden rounded-lg border border-slate-300 px-3 py-2 font-medium md:inline-block dark:border-slate-600">{density === "compact" ? "Comfortable rows" : "Compact rows"}</button>}
          <button onClick={reset} className="px-2 py-2 underline">Reset</button>
        </div>
      </div>
    </section>

    {selectedIds.length > 0 && <div className="mb-4 hidden items-center gap-3 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm md:flex dark:border-teal-900 dark:bg-teal-950">
      <strong>{selectedIds.length} selected</strong>
      <Link href={`/books/labels?ids=${selectedIds.join(",")}`} className="rounded-lg bg-teal-700 px-3 py-2 font-medium text-white dark:bg-teal-300 dark:text-slate-950">Print selected labels</Link>
      <button onClick={() => setSelected(new Set())} className="ml-auto underline">Clear selection</button>
    </div>}

    {error && <p className="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}
    {loading && books.length === 0 ? <p className="py-10 text-center text-slate-500">Loading…</p> : books.length === 0 ? <p className="py-10 text-center text-slate-500">{query || activeFilters ? "No books match your search and filters." : "No books yet."}</p> : <>
      {viewMode === "table" && <div className="catalog-table hidden max-h-[calc(100vh-13rem)] overflow-auto rounded-2xl border border-slate-200 bg-white shadow-sm md:block dark:border-slate-700 dark:bg-slate-800">
        <table className={`w-full text-sm ${density === "compact" ? "catalog-table-compact" : ""}`}>
          <thead className="sticky top-0 z-[1] bg-slate-100 text-left text-slate-600 shadow-[0_1px_0_#dbe3df] dark:bg-slate-800 dark:text-slate-300"><tr>
            <th><input type="checkbox" aria-label="Select all visible books" checked={allVisibleSelected} onChange={toggleVisible} /></th><th aria-label="Cover"></th><th>Book number</th><th>Title</th><th>Author(s)</th><th>Owner</th><th>Shelf</th><th>Year</th><th>Rating</th><th className="text-right">Actions</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">{books.map((book, index) => <tr key={book.id} className={`${index % 2 ? "bg-slate-50/55 dark:bg-slate-900/20" : ""} hover:bg-teal-50 dark:hover:bg-teal-950/40`}>
            <td><input type="checkbox" aria-label={`Select ${bookNumber(book.id)} ${book.title}`} checked={selected.has(book.id)} onChange={() => toggle(book.id)} /></td>
            <td><div className="relative flex h-14 w-10 items-center justify-center overflow-hidden rounded bg-slate-200 text-xs font-semibold text-slate-500 dark:bg-slate-700">{book.title.slice(0, 1).toUpperCase()}{book.coverImageUrl && <img src={book.coverImageUrl} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" onError={(event) => { event.currentTarget.style.display = "none"; }} />}</div></td>
            <td className="whitespace-nowrap font-mono text-xs text-slate-500">{bookNumber(book.id)}</td>
            <td><Link href={`/books/${book.id}`} className="font-semibold text-slate-900 hover:text-teal-700 hover:underline dark:text-slate-100 dark:hover:text-teal-300">{book.title}</Link><p className="mt-1 text-xs text-teal-700 dark:text-teal-300">{[book.bookType, ...(book.categories || []).map((category) => category.name)].filter(Boolean).join(" · ") || "Unclassified"}</p>{book.format && <p className="mt-1 text-xs capitalize text-slate-500">{book.format}</p>}</td>
            <td className="text-slate-600 dark:text-slate-300">{book.authors || "—"}</td><td>{book.owner?.name || <span className="text-slate-500">Unassigned</span>}</td>
            <td><span className="inline-block whitespace-nowrap rounded-md bg-slate-100 px-2 py-1 font-mono text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-300">{book.shelfLocation || "Unassigned"}</span></td>
            <td className="text-slate-600 dark:text-slate-300">{pubYear(book) || "—"}</td><td className="whitespace-nowrap"><Stars value={book.rating} /></td>
            <td><div className="flex justify-end gap-1"><Link href={`/books/${book.id}/label`} className="rounded-md px-2 py-1.5 text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700">Label</Link><Link href={`/books/${book.id}`} className="rounded-md px-2 py-1.5 font-medium text-teal-700 hover:bg-teal-100 dark:text-teal-300 dark:hover:bg-teal-950">{canEdit ? "Edit" : "View"}</Link>{canDelete && <button onClick={() => onDelete(book.id, book.title)} className="rounded-md px-2 py-1.5 text-red-600 hover:bg-red-100 dark:hover:bg-red-950">Delete</button>}</div></td>
          </tr>)}</tbody>
        </table>
      </div>}

      {viewMode === "cards" && <ul className="hidden gap-4 md:grid md:grid-cols-2 xl:grid-cols-3">{books.map((book) => <li key={book.id}><Link href={`/books/${book.id}`} className="flex h-full gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-teal-500 hover:shadow-md dark:border-slate-700 dark:bg-slate-800"><div className="relative flex h-24 w-16 shrink-0 items-center justify-center overflow-hidden rounded bg-slate-200 text-lg font-semibold text-slate-500 dark:bg-slate-700">{book.title.slice(0, 1).toUpperCase()}{book.coverImageUrl && <img src={book.coverImageUrl} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />}</div><div className="min-w-0"><p className="font-mono text-xs text-slate-500">{bookNumber(book.id)}</p><h2 className="mt-1 font-semibold">{book.title}</h2><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{book.authors || "Unknown author"}</p><p className="mt-2 text-xs text-teal-700 dark:text-teal-300">{[book.bookType, ...(book.categories || []).map((category) => category.name)].filter(Boolean).join(" · ") || "Unclassified"}</p></div></Link></li>)}</ul>}

      <ul className="space-y-2 md:hidden">{books.map((book) => <li key={book.id}><Link href={`/books/${book.id}`} className="block w-full rounded-xl border border-slate-200 bg-white p-4 text-left active:bg-slate-50 dark:border-slate-800 dark:bg-slate-800 dark:active:bg-slate-700"><div className="mb-1 font-mono text-xs text-slate-500">{bookNumber(book.id)}</div><div className="font-semibold">{book.title}</div><p className="mt-1 text-xs text-teal-700 dark:text-teal-300">{[book.bookType, ...(book.categories || []).map((category) => category.name)].filter(Boolean).join(" · ")}</p><div className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">{book.authors || "Unknown author"}</div><div className="mt-1 text-sm text-slate-500">Owner: {book.owner?.name || "Unassigned"}</div><div className="mt-2 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">{pubYear(book) && <span>{pubYear(book)}</span>}{book.format && <span className="capitalize">· {book.format}</span>}{book.rating ? <span className="ml-auto"><Stars value={book.rating} /></span> : null}</div></Link></li>)}</ul>
    </>}

    {canEdit && <Link href="/books/new" aria-label="Add book" className="safe-bottom fixed bottom-0 right-4 z-20 mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-teal-700 text-3xl leading-none text-white shadow-lg md:hidden dark:bg-teal-300 dark:text-slate-950">+</Link>}
  </div>;
}
