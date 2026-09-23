"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import BookIdScanner from "./BookIdScanner";
import { bookNumber } from "@/lib/books";
import { DEFAULT_LOAN_DAYS } from "@/lib/loans";

type Loan = { id: number; bookId: number; borrowedAt: string; dueAt: string; returnedAt: string | null; reminderSentAt: string | null; book: { title: string; shelfLocation: string | null }; borrower: { email: string } };
const localNow = () => { const now = new Date(); return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const date = (value: string) => new Date(value).toLocaleString();
const control = "mt-1 w-full min-w-0 rounded-lg border border-slate-300 bg-white p-3 text-base dark:border-slate-600 dark:bg-slate-900";
export default function Loans({ borrowers, locations }: { borrowers: { id: number; email: string }[]; locations: { code: string; label: string }[] }) {
  const [mode, setMode] = useState<"borrow" | "return">("borrow");
  const [bookId, setBookId] = useState("");
  const [borrowerId, setBorrower] = useState("");
  const [days, setDays] = useState(String(DEFAULT_LOAN_DAYS));
  const [borrowedAt, setBorrowedAt] = useState("");
  const [shelf, setShelf] = useState("");
  const [loans, setLoans] = useState<Loan[]>([]);
  const [filter, setFilter] = useState("active");
  const [query, setQuery] = useState("");
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const locked = useRef(false);
  const generation = useRef(0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { setBorrowedAt(localNow()); const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    try {
      const response = await fetch(`/api/loans?history=${filter === "history"}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load loans.");
      if (request === generation.current) setLoans(data);
    } catch (e) { if (request === generation.current) { setLoans([]); setError((e as Error).message); } }
    finally { if (request === generation.current) setLoading(false); }
  }, [filter]);
  useEffect(() => { void load(); }, [load]);
  const act = useCallback(async (action: "borrow" | "return" | "remind", raw = bookId, loanId?: number) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(""); setMessage(""); setScanning(false);
    try {
      const body = action === "remind" ? { action, loanId } : action === "return" ? { action, bookId: raw, shelfLocation: shelf } : { action, bookId: raw, borrowerId: Number(borrowerId), days: Number(days), borrowedAt: new Date(borrowedAt).toISOString() };
      const response = await fetch("/api/loans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not complete action.");
      setMessage(action === "borrow" ? `${result.book.title} borrowed by ${result.borrower.email}. Return by ${date(result.dueAt)}.` : result.message);
      if (action !== "remind") { setBookId(""); setBorrowedAt(localNow()); }
      await load();
    } catch (e) { setError((e as Error).message || "Could not complete action. Refresh before retrying."); }
    finally { locked.current = false; setBusy(false); }
  }, [bookId, shelf, borrowerId, days, borrowedAt, load]);
  const due = new Date(new Date(borrowedAt).getTime() + Number(days) * 86400000);
  const validBorrow = Boolean(borrowerId && borrowedAt && Number.isInteger(Number(days)) && Number(days) >= 1 && Number(days) <= 3650 && Number.isFinite(due.getTime()));
  const visible = loans.filter((loan) => (filter !== "overdue" || new Date(loan.dueAt).getTime() < now) && `${loan.book.title} ${loan.borrower.email} ${bookNumber(loan.bookId)}`.toLowerCase().includes(query.toLowerCase()));
  return <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-8">
    <Link href="/" className="text-sm underline">‹ Back to catalog</Link>
    <div><h1 className="text-3xl font-semibold">Borrowing & returns</h1><p className="mt-2 text-sm text-slate-500">Scan the library label on each copy, or enter its book ID using a keyboard or USB scanner.</p></div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}
    {message && <p role="status" className="rounded-lg bg-teal-50 p-4 text-teal-950 dark:bg-teal-950 dark:text-teal-100">{message}</p>}
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
      <section className="space-y-4 rounded-2xl border border-slate-200 p-5 dark:border-slate-700">
        <div className="flex gap-2">{(["borrow", "return"] as const).map((value) => <button key={value} disabled={busy} aria-pressed={mode === value} onClick={() => { setMode(value); setError(""); setMessage(""); setBookId(""); setBorrowedAt(localNow()); }} className={`flex-1 rounded-lg border p-3 font-medium ${mode === value ? "bg-teal-700 text-white" : ""}`}>{value === "borrow" ? "Lend a book" : "Return a book"}</button>)}</div>
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void act(mode); }}>
          <fieldset disabled={busy || scanning} className="min-w-0 space-y-4">
            {mode === "borrow" ? <>
              <label className="block text-sm">Borrower<select className={control} required value={borrowerId} onChange={(e) => setBorrower(e.target.value)}><option value="">Select an active account</option>{borrowers.map((user) => <option key={user.id} value={user.id}>{user.email}</option>)}</select></label>
              {!borrowers.length && <p className="text-sm">No active View or Librarian accounts. The owner can add or enable users in Manage users.</p>}
              <label className="block text-sm">Borrowing date & time<input type="datetime-local" className={control} required value={borrowedAt} onChange={(e) => setBorrowedAt(e.target.value)} /></label>
              <button type="button" className="text-sm underline" onClick={() => setBorrowedAt(localNow())}>Use current time</button>
              <label className="block text-sm">Borrow time (days)<input type="number" min="1" max="3650" step="1" required className={control} value={days} onChange={(e) => setDays(e.target.value)} /></label>
              <p className="rounded-lg bg-teal-50 p-3 text-sm text-teal-950 dark:bg-teal-950 dark:text-teal-100">Return by: <strong>{Number.isFinite(due.getTime()) && Number(days) >= 1 ? due.toLocaleString() : "Choose a date and borrow time"}</strong><span className="mt-1 block text-xs">Dates and times use this device’s local time.</span></p>
            </> : <label className="block text-sm">Return shelf<select className={control} value={shelf} onChange={(e) => setShelf(e.target.value)}><option value="">Use the book’s existing shelf</option>{locations.map((location) => <option key={location.code} value={location.code}>{location.code} · {location.label}</option>)}</select><span className="mt-2 block text-xs text-slate-500">After scanning, the confirmation shows where to put the book. Choose a shelf here if the book has none.</span></label>}
            <label className="block text-sm">Book ID<input className={control} value={bookId} onChange={(e) => setBookId(e.target.value)} required placeholder="B000123 or 123" autoComplete="off" /></label>
            <button className="w-full rounded-lg bg-teal-700 p-3 font-semibold text-white disabled:opacity-50" disabled={!bookId.trim() || (mode === "borrow" && !validBorrow)}>{busy ? "Saving…" : mode === "borrow" ? "Record borrowing" : "Record return"}</button>
            <button type="button" className="w-full rounded-lg border border-teal-600 p-3 font-semibold disabled:opacity-50" disabled={mode === "borrow" && !validBorrow} onClick={() => setScanning(true)}>Scan & {mode === "borrow" ? "lend" : "return"}</button>
          </fieldset>
        </form>
        <p className="text-xs text-slate-500">Scanning records the action immediately with the settings above. Phone camera access requires HTTPS.</p>
      </section>
      <section className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">Borrowed books</h2><button disabled={busy || loading} onClick={() => { setError(""); void load(); }} className="text-sm underline">Refresh</button></div>
        <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Show<select className={control} value={filter} disabled={busy} onChange={(e) => setFilter(e.target.value)}><option value="active">Currently borrowed</option><option value="overdue">Overdue</option><option value="history">Recent returns (up to 200)</option></select></label><label className="text-sm">Search<input className={control} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Book, ID, or borrower" /></label></div>
        {loading ? <p role="status">Loading loans…</p> : !visible.length ? <p className="py-8 text-center text-slate-500">No loans to show.</p> : <ul className="space-y-3">{visible.map((loan) => {
          const overdue = !loan.returnedAt && new Date(loan.dueAt).getTime() < now;
          return <li key={loan.id} className="space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
            <div className="flex flex-wrap justify-between gap-2"><Link href={`/books/${loan.bookId}`} className="font-semibold underline">{loan.book.title}</Link><span className={`text-sm font-medium ${overdue ? "text-red-600 dark:text-red-300" : "text-slate-500"}`}>{loan.returnedAt ? "Returned" : overdue ? "Overdue" : "Borrowed"}</span></div>
            <p className="break-words text-sm">{bookNumber(loan.bookId)} · {loan.borrower.email}</p>
            <dl className="grid gap-2 text-sm sm:grid-cols-2"><div><dt className="text-slate-500">Borrowed</dt><dd>{date(loan.borrowedAt)}</dd></div><div><dt className="text-slate-500">Return due</dt><dd>{date(loan.dueAt)}</dd></div>{loan.returnedAt && <div><dt className="text-slate-500">Returned</dt><dd>{date(loan.returnedAt)}</dd></div>}<div><dt className="text-slate-500">Shelf</dt><dd>{loan.book.shelfLocation || "Unassigned"}</dd></div></dl>
            {loan.reminderSentAt && <p className="text-xs text-slate-500">Last reminder sent: {date(loan.reminderSentAt)}</p>}
            {overdue && <button disabled={busy} onClick={() => void act("remind", "", loan.id)} className="rounded-lg border border-teal-600 px-4 py-3 text-sm font-medium disabled:opacity-50">Send reminder email</button>}
          </li>;
        })}</ul>}
      </section>
    </div>
    {scanning && <BookIdScanner onDetected={(raw) => { setBookId(raw); void act(mode, raw); }} onClose={() => setScanning(false)} />}
  </main>;
}
