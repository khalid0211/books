"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
type User = { id: number; email: string; role: string; active: boolean };
export default function UserManager() {
  const [users, setUsers] = useState<User[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("VIEW");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  async function load() {
    const res = await fetch("/api/users", { cache: "no-store" });
    if (!res.ok) throw new Error("Could not load users.");
    setUsers(await res.json());
  }
  useEffect(() => { load().catch((e) => setError(e.message)); }, []);
  async function save(email: string, role: string, active: boolean) {
    setBusy(true); setError(""); setNote("");
    try {
      const res = await fetch("/api/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, role, active }) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error || "Could not save user.");
      await load(); setNote("User access saved.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save user."); }
    finally { setBusy(false); }
  }
  return <main className="mx-auto max-w-2xl space-y-5 px-4 py-6"><Link href="/" className="text-sm underline">‹ Books</Link><h1 className="text-2xl font-semibold">Manage users</h1>
    <p className="text-sm text-slate-500">Only listed, enabled users can receive login codes. Librarians add and edit books and locations. View users can search and read books. Only the Owner can delete books or manage access.</p>
    {error && <p role="alert" className="text-red-600">{error}</p>}{note && <p role="status" className="text-emerald-600">{note}</p>}
    <form className="space-y-3 rounded-xl border p-4" onSubmit={(e) => { e.preventDefault(); void save(email, role, true); }}>
      <label className="block">Email<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-lg border bg-transparent p-3" /></label>
      <label className="block">Role<select value={role} onChange={(e) => setRole(e.target.value)} className="mt-1 w-full rounded-lg border bg-white p-3 dark:bg-slate-800"><option value="VIEW">View</option><option value="LIBRARIAN">Librarian</option></select></label>
      <button disabled={busy} className="rounded-lg bg-slate-900 p-3 text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">Add / update user</button>
    </form>
    <ul className="space-y-3">{users.map((u) => <li key={u.id} className="space-y-2 rounded-xl border p-4"><div className="break-all font-medium">{u.email}</div>{u.role === "OWNER" ? <p>Owner · Permanent access</p> : <div className="flex flex-wrap items-center gap-3"><select aria-label={`Role for ${u.email}`} disabled={busy} value={u.role} onChange={(e) => void save(u.email, e.target.value, u.active)} className="rounded border bg-white p-2 dark:bg-slate-800"><option value="VIEW">View</option><option value="LIBRARIAN">Librarian</option></select><span>{u.active ? "Enabled" : "Disabled"}</span><button disabled={busy} onClick={() => void save(u.email, u.role, !u.active)} className="underline">{u.active ? "Disable access" : "Enable access"}</button></div>}</li>)}</ul>
  </main>;
}
