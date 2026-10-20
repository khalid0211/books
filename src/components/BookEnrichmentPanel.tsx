"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
type Concept = { id: number; originalTerm: string; proposedName: string; weight: number; perspective: string | null; reviewStatus: string; concept: { name: string } | null };
type Revision = { id: number; overview: string | null; centralIdea: string | null; olDescription: string | null; olSourceUrl: string | null; olWorkId: string | null; olEditionId: string | null; knowledgeLevel: string; identityStatus: string; limitations: string; model: string; createdAt: string; reviewStatus: string; stale: boolean; concepts: Concept[] };
type Data = { manuallyLocked: boolean; publishedRevisionId: number | null; revisions: Revision[] };
type Edit = { id: number; name: string; weight: number; perspective: string; suppressed: boolean; saveAlias: boolean };
const input = "block w-full rounded-lg border border-slate-400 bg-transparent p-2";
export default function BookEnrichmentPanel({ bookId, owner = false }: { bookId: number; owner?: boolean }) {
  const [data, setData] = useState<Data | null>(null), [selected, setSelected] = useState<number | null>(null);
  const [overview, setOverview] = useState(""), [centralIdea, setCentralIdea] = useState(""), [concepts, setConcepts] = useState<Edit[]>([]), [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const revision = data?.revisions.find(r => r.id === selected);
  useEffect(() => { let mounted = true; void fetch(`/api/books/${bookId}/enrichment`, { cache: "no-store" }).then(async r => { if (!r.ok) throw new Error("Could not load additional book information."); return r.json(); }).then(d => { if (mounted) { setData(d); setSelected(d.revisions[0]?.id ?? null); } }).catch(e => { if (mounted) setError(e.message); }); return () => { mounted = false; }; }, [bookId]);
  useEffect(() => { setOverview(revision?.overview || ""); setCentralIdea(revision?.centralIdea || ""); setConfirmed(false); setConcepts((revision?.concepts || []).map(c => ({ id: c.id, name: c.concept?.name || c.proposedName, weight: c.weight, perspective: c.perspective || "", suppressed: c.reviewStatus === "suppressed", saveAlias: false }))); }, [revision]);
  async function action(body: unknown) {
    setBusy(true); setError("");
    try { const r = await fetch(`/api/books/${bookId}/enrichment`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const d = await r.json(); if (!r.ok) throw new Error(d.error || "Could not save review."); setData(d); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save review."); } finally { setBusy(false); }
  }
  return <section className="space-y-4 rounded-xl border p-4"><h2 className="text-xl font-semibold">Additional book information</h2>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    {!data ? <p>Loading…</p> : <>{owner && <div className="flex flex-wrap items-center gap-3"><Link href="/enrichment" className="underline">Enrich a catalogue range</Link>{data.revisions.length > 0 && <><label>Revision <select value={selected ?? ""} className="rounded border bg-transparent p-2" onChange={e => setSelected(Number(e.target.value))}>{data.revisions.map(r => <option key={r.id} value={r.id}>{r.id} · {r.reviewStatus}{r.id === data.publishedRevisionId ? " · published" : ""}</option>)}</select></label><button type="button" disabled={busy} className="underline" onClick={() => void action({ action: "lock", locked: !data.manuallyLocked })}>{data.manuallyLocked ? "Unlock regeneration" : "Lock regeneration"}</button>{data.publishedRevisionId && <button type="button" disabled={busy} className="underline" onClick={() => void action({ action: "unpublish" })}>Unpublish</button>}</>}</div>}
    {!revision ? <p>No published additional information yet.</p> : <>
      {revision.stale && <p role="status" className="text-amber-700">Catalogue identity changed since generation. Regenerate before publishing.</p>}
      <p className="text-sm">AI-generated · {revision.model} · {new Date(revision.createdAt).toLocaleString()} · knowledge: {revision.knowledgeLevel} · identity: {revision.identityStatus}</p>
      {revision.olDescription && <div><h3 className="font-semibold">Open Library description</h3><p className="whitespace-pre-wrap">{revision.olDescription}</p>{revision.olSourceUrl?.startsWith("https://openlibrary.org/") && <a href={revision.olSourceUrl} target="_blank" rel="noreferrer" className="underline">Open Library source</a>}</div>}
      {owner && (revision.olWorkId || revision.olEditionId) && <p className="text-sm">{revision.olWorkId} {revision.olEditionId}</p>}
      {owner ? <><label className="block">AI overview<textarea rows={5} maxLength={4000} value={overview} onChange={e => setOverview(e.target.value)} className={input} /></label><label className="block">Central idea / theme<textarea rows={2} maxLength={1500} value={centralIdea} onChange={e => setCentralIdea(e.target.value)} className={input} /></label>
        <h3 className="font-semibold">Concepts · review canonical names and perspectives</h3>{concepts.map((c, i) => <div key={c.id} className="space-y-2 rounded border p-3"><p className="text-sm">Original term: {revision.concepts.find(v => v.id === c.id)?.originalTerm}</p>
          <label>Canonical name<input value={c.name} maxLength={100} className={input} onChange={e => setConcepts(v => v.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} /></label>
          <label>Importance (0–1)<input type="number" min={0} max={1} step={0.01} value={c.weight} className={input} onChange={e => setConcepts(v => v.map((x, j) => j === i ? { ...x, weight: Number(e.target.value) } : x))} /></label>
          <label>Book perspective<textarea value={c.perspective} maxLength={1500} className={input} onChange={e => setConcepts(v => v.map((x, j) => j === i ? { ...x, perspective: e.target.value } : x))} /></label>
          <label className="mr-4 inline-flex gap-2"><input type="checkbox" checked={c.suppressed} onChange={e => setConcepts(v => v.map((x, j) => j === i ? { ...x, suppressed: e.target.checked } : x))} />Suppress concept</label><label className="inline-flex gap-2"><input type="checkbox" checked={c.saveAlias} onChange={e => setConcepts(v => v.map((x, j) => j === i ? { ...x, saveAlias: e.target.checked } : x))} />Remember original term as alias</label>
        </div>)}
        <label className="flex gap-2"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I checked that the sources and generated information describe this exact book.</label>
        <button type="button" disabled={busy || !confirmed || revision.stale || revision.knowledgeLevel === "insufficient" || !overview.trim()} className="rounded-lg bg-teal-700 px-4 py-2 text-white disabled:opacity-50" onClick={() => void action({ action: "publish", revisionId: revision.id, identityConfirmed: confirmed, overview, centralIdea, concepts })}>Save corrections and publish · locks regeneration</button>
      </> : <><div><h3 className="font-semibold">AI overview</h3><p className="whitespace-pre-wrap">{revision.overview}</p></div>{revision.centralIdea && <div><h3 className="font-semibold">Central idea / theme</h3><p>{revision.centralIdea}</p></div>}<div className="flex flex-wrap gap-2">{revision.concepts.filter(c => c.reviewStatus === "approved").map(c => <span key={c.id} title={c.perspective || ""} className="rounded-full bg-teal-100 px-3 py-1 text-teal-950">{c.concept?.name || c.proposedName}</span>)}</div></>}
      <p className="text-sm text-slate-500">{revision.limitations}</p>
    </>}</>}
  </section>;
}
