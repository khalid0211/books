"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type Owner = { id: number; name: string; _count: { books: number } };
const input = "w-full rounded-lg border bg-white p-3 dark:bg-slate-800";
export default function OwnersPage() {
  const [owners, setOwners] = useState<Owner[]>([]);
  const [name, setName] = useState("");
  const [id, setId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function load() {
    const res = await fetch("/api/owners", { cache: "no-store" });
    if (!res.ok) throw new Error("Could not load book owners. Reload to try again.");
    setOwners(await res.json());
  }
  useEffect(() => { load().catch((e) => setError(e.message)).finally(() => setLoading(false)); }, []);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const res = await fetch("/api/owners", { method: id === null ? "POST" : "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, name }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save owner.");
      setName(""); setId(null); await load(); setMessage("Book owner saved.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save owner."); }
    finally { setBusy(false); }
  }
  return <main className="mx-auto max-w-xl space-y-5 px-4 py-6">
    <Link href="/" className="text-sm underline">‹ Books</Link>
    <h1 className="text-2xl font-semibold">Manage book owners</h1>
    <p className="text-sm text-slate-500">Add the people whose books are in your library. Choose a name when adding or editing a book. Renaming an owner updates all their books.</p>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    {message && <p role="status" className="text-emerald-600">{message}</p>}
    <form onSubmit={save} className="space-y-3 rounded-xl border p-4">
      <label className="block">Book owner name<input required maxLength={80} disabled={busy || loading} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mahira" className={input} /></label>
      <button disabled={busy || loading} className="rounded-lg bg-teal-700 px-4 py-3 text-white disabled:opacity-50 dark:bg-teal-300 dark:text-slate-950">{busy ? "Saving…" : id === null ? "Add owner" : "Save name"}</button>
      {id !== null && <button type="button" disabled={busy} onClick={() => { setId(null); setName(""); }} className="ml-3 underline">Cancel</button>}
    </form>
    {loading ? <p>Loading owners…</p> : !owners.length ? <p>No book owners yet.</p> : <ul className="divide-y rounded-xl border px-4">{owners.map((o) => <li key={o.id} className="flex items-center justify-between gap-3 py-3"><div><strong>{o.name}</strong><p className="text-sm text-slate-500">{o._count.books} books</p></div><button disabled={busy} onClick={() => { setId(o.id); setName(o.name); setMessage(""); }} className="p-2 underline" aria-label={`Rename ${o.name}`}>Rename</button></li>)}</ul>}
  </main>;
}
