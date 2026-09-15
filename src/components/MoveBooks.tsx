"use client";
import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { bookNumber } from "@/lib/books";
import { parseBookId } from "@/lib/book-id";
import BookIdScanner from "./BookIdScanner";

export default function MoveBooks({ locations }: { locations: { code: string; label: string }[] }) {
  const [shelf, setShelf] = useState("");
  const [bookId, setBookId] = useState("");
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [success, setSuccess] = useState<{ title: string; id: number; unchanged: boolean } | null>(null);
  const scanButton = useRef<HTMLButtonElement>(null);
  const locked = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const move = useCallback(async (raw: string) => {
    if (locked.current) return;
    setScanning(false); setBookId(raw); setError(""); setSuccess(null);
    if (!shelf || !parseBookId(raw)) { setError("Select a shelf and enter a book ID such as B000123 or 123."); return; }
    locked.current = true; setBusy(true);
    try {
      const response = await fetch("/api/books/move", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookId: raw, shelfLocation: shelf }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not move book.");
      const message = `${bookNumber(result.id)} · ${result.title}: ${result.unchanged ? `already on ${result.shelfLocation}` : `${result.previousLocation || "Unassigned"} → ${result.shelfLocation}`}`;
      setHistory((items) => [message, ...items].slice(0, 20)); setBookId("");
      setSuccess({ title: result.title, id: result.id, unchanged: result.unchanged });
    } catch (err) { setError(err instanceof Error ? err.message : "Could not move book. Check its location before retrying."); }
    finally { locked.current = false; setBusy(false); requestAnimationFrame(() => scanButton.current?.focus()); }
  }, [shelf]);
  const control = "mt-2 w-full min-w-0 rounded-xl border border-slate-300 bg-white p-3 text-base disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800";
  return <main className="mx-auto max-w-xl space-y-5 px-4 py-6">
    <Link href="/" className="underline">‹ Back to catalog</Link>
    <div><h1 className="text-3xl font-semibold tracking-tight">Move books</h1><p className="mt-2 text-sm text-slate-500">Choose a shelf. Scan a book. Done.</p></div>
    {!locations.length ? <p>Add a shelf in <Link href="/locations" className="underline">Locations</Link> before moving books.</p> : <>
      <label className="block rounded-2xl border border-slate-200 bg-white p-4 text-sm font-medium shadow-sm dark:border-slate-700 dark:bg-slate-800">Destination shelf<select className={control} value={shelf} disabled={busy || scanning} onChange={(e) => { setShelf(e.target.value); setError(""); setSuccess(null); }}><option value="">Select a shelf</option>{locations.map((location) => <option key={location.code} value={location.code}>{location.code} · {location.label}</option>)}</select></label>
      <div role="status" aria-live="polite" aria-atomic="true" className={`flex min-h-36 flex-col items-center justify-center rounded-2xl border p-5 text-center ${success ? "border-teal-200 bg-teal-50 text-teal-900 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-100" : "border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-800"}`}>
        {busy ? <p className="text-xl font-semibold">Moving…</p> : success ? <><span aria-hidden="true" className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-teal-700 text-xl text-white">✓</span><p className="text-2xl font-semibold">{success.unchanged ? "Already on this shelf" : "Moved"}</p><p className="mt-1 text-sm">{bookNumber(success.id)} · {success.title}</p></> : <p>{shelf ? "Ready to scan" : "Select a destination to begin"}</p>}
      </div>
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">{error}</p>}
      <button ref={scanButton} className="app-primary flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl px-5 py-4 text-lg font-semibold shadow-sm disabled:opacity-50" disabled={!shelf || busy} onClick={() => { setError(""); setSuccess(null); setScanning(true); }}><svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M7 8v8m4-8v8m3-8v8m3-8v8" /></svg>{busy ? "Moving…" : success ? "Scan next book" : "Scan book ID"}</button>
      <details className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"><summary className="cursor-pointer text-sm font-medium">Enter book ID manually</summary><form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); void move(bookId); }}>
        <label className="block">Book ID<input ref={input} className={control} value={bookId} onChange={(e) => setBookId(e.target.value)} placeholder="B000123 or 123" autoComplete="off" disabled={!shelf || busy} required /></label>
        <button className="w-full rounded-lg bg-teal-700 p-3 text-white disabled:opacity-50 dark:bg-teal-300 dark:text-slate-950" disabled={!shelf || busy || !bookId.trim()}>{busy ? "Moving…" : "Move book"}</button>
      </form></details>
      <p className="text-center text-xs text-slate-500">Use the barcode on your library label. Existing QR labels also work.</p>
    </>}
    {history.length > 0 && <details className="text-sm text-slate-500"><summary className="cursor-pointer py-2">Recent moves ({history.length})</summary><ul className="mt-2 space-y-3">{history.map((item, i) => <li key={i}>{item}</li>)}</ul></details>}
    {scanning && <BookIdScanner onDetected={move} onClose={() => { setScanning(false); scanButton.current?.focus(); }} />}
  </main>;
}

