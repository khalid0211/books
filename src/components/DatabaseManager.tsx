"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

export default function DatabaseManager() {
  const [file, setFile] = useState<File | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function restore(event: FormEvent) {
    event.preventDefault();
    if (!file || confirmation !== "RESTORE") return;
    if (!window.confirm(`Restore ${file.name}? The current catalog and users will be replaced by this backup.`)) return;
    setRestoring(true); setMessage(""); setError("");
    try {
      const body = new FormData();
      body.set("backup", file);
      body.set("confirmation", confirmation);
      const response = await fetch("/api/database/restore", { method: "POST", body });
      const result = await response.json().catch(() => ({})) as { error?: string; message?: string; safetyBackup?: string };
      if (!response.ok) throw new Error(result.error || "Could not restore the database.");
      setMessage(`${result.message || "Database restored successfully."}${result.safetyBackup ? ` A safety copy of the previous database remains on the VPS as ${result.safetyBackup}.` : ""}`);
      setFile(null); setConfirmation("");
      const input = document.querySelector<HTMLInputElement>("#backup-file");
      if (input) input.value = "";
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not restore the database.");
    } finally {
      setRestoring(false);
    }
  }

  return <main className="mx-auto max-w-2xl space-y-7 px-4 py-6">
    <Link href="/" className="text-sm underline">‹ Books</Link>
    <div><h1 className="text-2xl font-semibold">Database backup and restore</h1><p className="mt-2 text-slate-600 dark:text-slate-300">Owner access only. Backups contain the catalog, locations, owners, users, and login sessions.</p></div>

    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
      <h2 className="text-xl font-semibold">Download backup</h2>
      <p>Creates a consistent snapshot of the live VPS database and downloads it to this computer. The application can remain online.</p>
      <a href="/api/database/backup" download className="inline-block rounded-lg bg-teal-700 px-4 py-3 font-medium text-white dark:bg-teal-300 dark:text-slate-950">Download database backup</a>
    </section>

    <section className="space-y-3 rounded-xl border border-red-200 bg-white p-5 dark:border-red-900 dark:bg-slate-800">
      <h2 className="text-xl font-semibold">Restore backup</h2>
      <p>Restoring replaces the current VPS database with the selected backup. A safety copy of the current database is retained on the VPS.</p>
      <form onSubmit={restore} className="space-y-4">
        <label className="block text-sm font-medium">SQLite backup file (.db)<input id="backup-file" type="file" accept=".db,application/vnd.sqlite3,application/x-sqlite3" required onChange={(event) => setFile(event.target.files?.[0] || null)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2 text-base dark:border-slate-700 dark:bg-slate-900" /></label>
        <label className="block text-sm font-medium">Type <strong>RESTORE</strong> to confirm<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required autoComplete="off" className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base dark:border-slate-700 dark:bg-slate-900" /></label>
        <button disabled={!file || confirmation !== "RESTORE" || restoring} className="rounded-lg bg-red-700 px-4 py-3 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">{restoring ? "Checking and restoring…" : "Restore database"}</button>
      </form>
    </section>
    {message && <p role="status" className="rounded-lg bg-green-100 p-3 text-green-900 dark:bg-green-950 dark:text-green-100">{message}</p>}
    {error && <p role="alert" className="rounded-lg bg-red-100 p-3 text-red-900 dark:bg-red-950 dark:text-red-100">{error}</p>}
  </main>;
}
