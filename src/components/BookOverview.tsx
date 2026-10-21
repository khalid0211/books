"use client";
import { useEffect, useState } from "react";

type Revision = { id: number; overview: string | null; centralIdea: string | null; reviewStatus: string; stale: boolean; knowledgeLevel: string; sourceLabel: string; concepts: { id: number; proposedName: string; reviewStatus: string; concept: { name: string } | null }[] };
export function overviewRevision(data: { publishedRevisionId: number | null; revisions: Revision[] }, owner: boolean) {
  const usable = (r: Revision) => !r.stale && r.knowledgeLevel !== "insufficient" && Boolean(r.overview?.trim());
  return data.revisions.find(r => r.id === data.publishedRevisionId && r.reviewStatus === "approved" && usable(r))
    ?? (owner ? data.revisions.find(usable) : undefined);
}

export default function BookOverview({ bookId, owner = false, onOpenInsights }: { bookId: number; owner?: boolean; onOpenInsights?: () => void }) {
  const [revision, setRevision] = useState<Revision | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(false);
  const [published, setPublished] = useState(false);
  useEffect(() => {
    let mounted = true, request = 0;
    async function load() {
      const current = ++request;
      try {
        const response = await fetch(`/api/books/${bookId}/enrichment`, { cache: "no-store" });
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (mounted && current === request) { const selected = overviewRevision(data, owner); setRevision(selected ?? null); setPublished(Boolean(selected && selected.id === data.publishedRevisionId)); setError(false); }
      } catch { if (mounted && current === request) setError(true); }
      finally { if (mounted && current === request) setLoading(false); }
    }
    void load(); window.addEventListener("enrichment-updated", load);
    return () => { mounted = false; window.removeEventListener("enrichment-updated", load); };
  }, [bookId, owner]);
  return <section aria-label="AI overview" className="book-form-card space-y-3">
    <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">AI overview</h2>{onOpenInsights && <button type="button" onClick={onOpenInsights} className="shrink-0 text-sm text-teal-700 underline dark:text-teal-300">Full AI insights</button>}</div>
    {loading ? <p className="text-sm text-slate-500">Loading overview…</p> : error ? <p role="status" className="text-sm text-slate-500">Could not load the overview. Open AI insights to try again.</p> : !revision ? <p className="text-sm text-slate-500">No current AI overview available yet.</p> : <>
      <p className="text-xs font-medium text-teal-700 dark:text-teal-300">AI-generated · {published ? "Approved" : revision.reviewStatus === "approved" ? "Unpublished · Owner preview" : "Draft · needs review"}</p>
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{revision.overview}</p>
      {revision.centralIdea && <div className="border-l-2 border-teal-600 pl-3"><h3 className="text-xs font-semibold uppercase tracking-wide">Central idea / theme</h3><p className="mt-1 text-sm leading-relaxed">{revision.centralIdea}</p></div>}
      <div className="flex flex-wrap gap-1.5">{revision.concepts.filter(c => c.reviewStatus !== "suppressed").slice(0, 6).map(c => <span key={c.id} className="rounded-full bg-teal-50 px-2 py-1 text-xs text-teal-900 dark:bg-teal-950 dark:text-teal-100">{c.concept?.name || c.proposedName}</span>)}</div>
      <p className="text-xs text-slate-500">{revision.sourceLabel}</p>
    </>}
  </section>;
}
