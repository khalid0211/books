"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { bookNumber } from "@/lib/books";
type Settings = { model: string; inputRate: number; outputRate: number; budgetUsd: number; maxBooks: number; keySaved: boolean; keyUsable: boolean; encryptionReady: boolean };
type Preview = { rows: { id: number; title: string; authors: string; eligible: boolean; reason: string }[]; eligible: number; missing: number; maxBooks: number; estimatedMaximumUsd: number; budgetUsd: number };
type Job = { id: number; status: string; model: string; accountedUsd: number; budgetUsd: number; inputTokens: number; outputTokens: number; message: string | null; items: { id: number; status: string; attempts: number; error: string | null; bookId: number; book?: { id: number; title: string } }[] };
const input = "block w-full rounded-lg border border-slate-400 bg-transparent p-2";
const button = "rounded-lg bg-teal-700 px-4 py-2 text-white disabled:opacity-50";
function Spinner() { return <span aria-hidden="true" className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none" />; }
async function api(path: string, body?: unknown) {
  const response = await fetch(`/api/enrichment/${path}`, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || "Request failed."); return result;
}
export default function EnrichmentManager() {
  const [settings, setSettings] = useState<Settings | null>(null), [apiKey, setApiKey] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]), [preview, setPreview] = useState<Preview | null>(null);
  const [start, setStart] = useState("B0001"), [end, setEnd] = useState("B0010"), [regenerate, setRegenerate] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [jobsLoaded, setJobsLoaded] = useState(false), [startingRun, setStartingRun] = useState(false);
  const activeJob = jobs.find(job => job.status === "queued" || job.status === "running" || job.items.some(item => item.status === "running"));
  const rangeDisabled = busy || !jobsLoaded || Boolean(activeJob);
  async function refreshJobs() { setJobs(await api("jobs")); setJobsLoaded(true); }
  useEffect(() => {
    let mounted = true;
    void Promise.all([api("settings"), api("jobs")]).then(([s, j]) => { if (mounted) { setSettings(s); setJobs(j); setJobsLoaded(true); } }).catch(e => { if (mounted) setError(e.message); });
    const timer = setInterval(() => { void api("jobs").then(j => { if (mounted) { setJobs(j); setJobsLoaded(true); } }).catch(e => { if (mounted) setError(e.message); }); }, 4000);
    return () => { mounted = false; clearInterval(timer); };
  }, []);
  async function run(fn: () => Promise<void>) { setBusy(true); setError(""); setMessage(""); try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "Request failed."); } finally { setBusy(false); } }
  function changeRange() { setPreview(null); }
  return <main className="mx-auto max-w-4xl space-y-6 px-4 py-6">
    <Link href="/" className="underline">‹ Books</Link><h1 className="text-2xl font-semibold">Enrich books</h1>
    <p>Retrieve Open Library descriptions and create AI overviews and concepts. If no matched description is available, OpenAI can use its own knowledge with a clear AI-only label. Sufficient results are approved automatically and used to find related books. Uncertain or insufficient results need attention.</p>
    <section className="space-y-3 rounded-xl border p-4"><h2 className="text-xl font-semibold">Use existing enrichments</h2><p>Existing drafts are checked automatically in the background. You can also apply the approval policy now without regenerating books or spending API credits. Manual locks and unpublished records are preserved.</p><button type="button" disabled={busy} className={button} onClick={() => void run(async () => { const result = await api("approve-existing", {}); await refreshJobs(); setMessage(`${result.approved} approved; ${result.insufficient} insufficient; ${result.needsReview} need attention; ${result.skipped} protected or superseded. ${result.remaining} remain for background processing.`); })}>Approve sufficient existing enrichments</button></section>
    {error && <p role="alert" className="rounded-lg bg-red-100 p-3 text-red-900">{error}</p>}{message && <p role="status">{message}</p>}
    {settings && <section className="space-y-4 rounded-xl border p-4"><h2 className="text-xl font-semibold">OpenAI settings · Owner only</h2>
      {!settings.encryptionReady && <p>Set ENRICHMENT_SECRET on the server before saving an API key. See the deployment instructions.</p>}
      {settings.keySaved && <p>{settings.keyUsable ? "API key saved (hidden)." : "Saved key cannot be decrypted. Restore the server secret or replace the key."}</p>}
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); void run(async () => { setSettings(await api("settings", { ...settings, apiKey })); setApiKey(""); setPreview(null); setMessage("Settings saved."); }); }}>
        <label>API key<input type="password" autoComplete="new-password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={settings.keySaved ? "Leave blank to keep saved key" : "Paste your API key"} className={input} /></label>
        <label>Model ID<input required value={settings.model} onChange={e => setSettings({ ...settings, model: e.target.value })} placeholder="Enter a model supporting Structured Outputs" className={input} /></label>
        {([['inputRate', 'Input price · USD / million tokens'], ['outputRate', 'Output price · USD / million tokens'], ['budgetUsd', 'Maximum accounted cost per run · USD'], ['maxBooks', 'Maximum books per run (1–100)']] as const).map(([key, label]) => <label key={key}>{label}<input type="number" required min={key === "maxBooks" ? 1 : 0.000001} max={key === "maxBooks" || key === "budgetUsd" ? 100 : 10000} step={key === "maxBooks" ? 1 : "any"} value={settings[key]} onChange={e => setSettings({ ...settings, [key]: Number(e.target.value) })} className={input} /></label>)}
        <p className="text-sm sm:col-span-2">Enter current standard token prices for your chosen model. Cost figures are estimates based on these rates; failed requests with uncertain billing retain their reservation. <a href="https://developers.openai.com/api/docs/pricing" target="_blank" rel="noreferrer" className="underline">OpenAI pricing</a></p>
        <div className="flex flex-wrap gap-2 sm:col-span-2"><button disabled={busy} className={button}>Save settings</button><button type="button" disabled={busy || !settings.keyUsable} className={button} onClick={() => void run(async () => { setMessage((await api("test", {})).message); })}>Test saved connection</button>{settings.keySaved && <button type="button" disabled={busy} className="underline" onClick={() => void run(async () => { setSettings(await api("settings", { ...settings, removeKey: true })); setMessage("API key removed."); })}>Remove saved key</button>}</div>
      </form>
    </section>}
    <section aria-busy={startingRun || Boolean(activeJob)} className="space-y-4 rounded-xl border p-4"><h2 className="text-xl font-semibold">Select a catalogue range</h2>
      {(startingRun || activeJob) && <p role="status" className="flex items-center gap-2 text-teal-800 dark:text-teal-200"><Spinner />{startingRun ? "Starting enrichment…" : activeJob?.status === "queued" ? "Enrichment queued…" : activeJob?.status === "running" ? "Enrichment running…" : "Finishing the current book…"} {activeJob && `${activeJob.items.filter(item => item.status !== "queued" && item.status !== "running").length} of ${activeJob.items.length} books processed.`}</p>}
      <form className="flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); if (rangeDisabled) return; void run(async () => { setPreview(await api("preview", { start, end, regenerate })); }); }}>
        <label>From<input disabled={rangeDisabled} value={start} onChange={e => { setStart(e.target.value); changeRange(); }} className={input} required /></label><label>To<input disabled={rangeDisabled} value={end} onChange={e => { setEnd(e.target.value); changeRange(); }} className={input} required /></label>
        <label className="flex items-center gap-2"><input disabled={rangeDisabled} type="checkbox" checked={regenerate} onChange={e => { setRegenerate(e.target.checked); changeRange(); }} />Regenerate existing drafts (locked books skipped)</label><button disabled={rangeDisabled} className={button}>Preview range</button>
      </form>
      {preview && <><p>{preview.eligible} eligible; {preview.missing} missing numbers skipped. First-attempt reservation estimate: ${preview.estimatedMaximumUsd.toFixed(4)}; run cap: ${preview.budgetUsd.toFixed(2)}.</p>
        <ul className="max-h-80 space-y-2 overflow-auto">{preview.rows.map(b => <li key={b.id}><Link href={`/books/${b.id}`} className="underline">{bookNumber(b.id)} · {b.title}</Link><span className="block text-sm">{b.authors} · {b.reason || "Ready"}</span></li>)}</ul>
        <button className={button} disabled={rangeDisabled || !settings?.keyUsable || preview.eligible < 1 || preview.eligible > preview.maxBooks || preview.estimatedMaximumUsd > preview.budgetUsd} onClick={() => { if (rangeDisabled) return; void run(async () => { setStartingRun(true); try { const created = await api("jobs", { start, end, regenerate }); setJobs(current => [created, ...current.filter(job => job.id !== created.id)]); setPreview(null); await refreshJobs(); setMessage("Enrichment run queued. You may leave this page; processing continues on the server."); } finally { setStartingRun(false); } }); }}>Start enrichment · uses paid OpenAI API</button></>}
    </section>
    <section className="space-y-4"><h2 className="text-xl font-semibold">Recent runs</h2>{jobs.length === 0 && <p>No enrichment runs yet.</p>}{jobs.map(job => <article key={job.id} className="space-y-3 rounded-xl border p-4"><h3 className="font-semibold">Run {job.id} · {job.status} · {job.model}</h3><p>Accounted estimate ${job.accountedUsd.toFixed(4)} / ${job.budgetUsd.toFixed(2)} · {job.inputTokens} input / {job.outputTokens} output tokens</p>{job.message && <p>{job.message}</p>}
      <div className="flex flex-wrap gap-3">{(job.status === "queued" || job.status === "running" ? ["pause", "cancel"] : job.status === "paused" ? ["resume", "retry", "cancel"] : job.status === "completed" ? ["retry"] : []).map(action => <button key={action} disabled={busy} type="button" className="capitalize underline" onClick={() => void run(async () => { await api("control", { id: job.id, action }); await refreshJobs(); })}>{action === "retry" ? "Retry failures" : action}</button>)}</div>
      <ul className="max-h-80 space-y-2 overflow-auto">{job.items.map(item => <li key={item.id}><Link href={`/books/${item.book?.id ?? item.bookId}`} className="underline">{bookNumber(item.book?.id ?? item.bookId)} · {item.book?.title || "Book details loading…"}</Link> · {item.status}{item.error && <p className="text-sm">{item.error}</p>}</li>)}</ul>
    </article>)}</section>
  </main>;
}
