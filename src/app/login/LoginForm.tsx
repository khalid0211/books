"use client";
import { useState } from "react";

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function submit(action: string) {
    setBusy(true); setError(""); setMessage("");
    try {
      const res = await fetch(`/api/auth/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, code }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unable to sign in.");
      if (action === "verify") window.location.assign("/");
      else { setSent(true); setMessage(data.message); }
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to sign in."); }
    finally { setBusy(false); }
  }
  return <main className="mx-auto max-w-md px-4 py-16"><h1 className="text-2xl font-semibold">Sign in to Book Catalog</h1>
    <p className="mt-3 text-sm text-slate-500">Use the email address added by your library Owner. Your login lasts 30 days.</p>
    <form className="mt-6 space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(sent ? "verify" : "request-code"); }}>
      <label className="block">Email<input type="email" required autoComplete="email" disabled={sent || busy} value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-lg border bg-transparent p-3" /></label>
      {sent && <label className="block">Six-digit code<input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} className="mt-1 w-full rounded-lg border bg-transparent p-3 text-xl tracking-widest" /></label>}
      {error && <p role="alert" className="text-red-600">{error}</p>}{message && <p role="status" className="text-sm text-slate-500">{message}</p>}
      <button disabled={busy} className="w-full rounded-lg bg-teal-700 p-3 text-white disabled:opacity-50 dark:bg-teal-300 dark:text-slate-950">{busy ? "Please wait…" : sent ? "Sign in" : "Email me a code"}</button>
      {sent && <div className="flex justify-between text-sm"><button type="button" disabled={busy} onClick={() => { setSent(false); setCode(""); setMessage(""); setError(""); }}>Change email</button><button type="button" disabled={busy} onClick={() => void submit("request-code")}>Resend code</button></div>}
    </form></main>;
}
