"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Book } from "@/lib/books";
import { pubYear } from "@/lib/books";
import Stars from "@/components/Stars";

export default function BookList() {
  const router = useRouter();
  const [books, setBooks] = useState<Book[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);

  const load = useCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/books?q=${encodeURIComponent(q)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      setBooks(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load books");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load("");
  }, [load]);

  function onSearch(value: string) {
    setQuery(value);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void load(value.trim()), 250);
  }

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
    <div className="mx-auto max-w-5xl px-4 pb-24 md:pb-10">
      {/* Sticky header with title + search */}
      <header className="sticky top-0 z-10 -mx-4 mb-4 border-b border-slate-200 bg-slate-50/90 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold md:text-xl">Book Catalog</h1>
          <Link
            href="/books/new"
            className="hidden rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 md:inline-block dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
          >
            + New book
          </Link>
        </div>
        <div className="mt-2">
          <input
            type="search"
            inputMode="search"
            placeholder="Search title, author, ISBN, tags…"
            value={query}
            onChange={(e) => onSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-800"
          />
        </div>
      </header>

      {error && (
        <p className="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}

      {loading && books.length === 0 ? (
        <p className="py-10 text-center text-slate-500">Loading…</p>
      ) : books.length === 0 ? (
        <p className="py-10 text-center text-slate-500">
          {query ? "No books match your search." : "No books yet. Add your first one."}
        </p>
      ) : (
        <>
          {/* Desktop: table */}
          <div className="hidden overflow-x-auto rounded-lg border border-slate-200 md:block dark:border-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 text-left text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                <tr>
                  <th className="px-3 py-2 font-medium">Title</th>
                  <th className="px-3 py-2 font-medium">Author(s)</th>
                  <th className="px-3 py-2 font-medium">Year</th>
                  <th className="px-3 py-2 font-medium">Format</th>
                  <th className="px-3 py-2 font-medium">Rating</th>
                  <th className="px-3 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {books.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-3 py-2">
                      <Link href={`/books/${b.id}`} className="font-medium text-slate-900 hover:underline dark:text-slate-100">
                        {b.title}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{b.authors || "—"}</td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{pubYear(b) || "—"}</td>
                    <td className="px-3 py-2 text-slate-600 capitalize dark:text-slate-300">{b.format || "—"}</td>
                    <td className="px-3 py-2"><Stars value={b.rating} /></td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-2">
                        <Link href={`/books/${b.id}`} className="rounded px-2 py-1 text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700">
                          Edit
                        </Link>
                        <button
                          onClick={() => onDelete(b.id, b.title)}
                          className="rounded px-2 py-1 text-red-600 hover:bg-red-100 dark:hover:bg-red-950"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: cards */}
          <ul className="space-y-2 md:hidden">
            {books.map((b) => (
              <li key={b.id}>
                <button
                  onClick={() => router.push(`/books/${b.id}`)}
                  className="w-full rounded-xl border border-slate-200 bg-white p-4 text-left active:bg-slate-50 dark:border-slate-800 dark:bg-slate-800 dark:active:bg-slate-700"
                >
                  <div className="font-semibold">{b.title}</div>
                  <div className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">{b.authors || "Unknown author"}</div>
                  <div className="mt-2 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    {pubYear(b) && <span>{pubYear(b)}</span>}
                    {b.format && <span className="capitalize">· {b.format}</span>}
                    {b.rating ? <span className="ml-auto"><Stars value={b.rating} /></span> : null}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Mobile: floating add button */}
      <Link
        href="/books/new"
        aria-label="Add book"
        className="safe-bottom fixed bottom-0 right-4 z-20 mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-900 text-3xl leading-none text-white shadow-lg md:hidden dark:bg-slate-100 dark:text-slate-900"
      >
        +
      </Link>
    </div>
  );
}
