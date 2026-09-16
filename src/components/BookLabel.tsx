"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { bookNumber } from "@/lib/books";
import { renderBookLabel } from "@/lib/render-book-label";

export default function BookLabel({ id, title, owner }: { id: number; title: string; owner: string }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [shortened, setShortened] = useState(false);
  const paperWidth = "50.8mm";
  const paperHeight = "25.4mm";
  useEffect(() => {
    try {
      setError("");
      // 600 × 300 pixels gives a 300 dpi image at 2 × 1 inches.
      const label = renderBookLabel(id, title, owner);
      setShortened(label.shortened); setUrl(label.url);
    } catch { setError("Could not prepare the label. Reload to try again."); }
  }, [id, title, owner]);
  const button = "inline-block rounded-lg bg-teal-700 px-4 py-3 text-white disabled:opacity-50 dark:bg-teal-300 dark:text-slate-950";
  return <main className="label-page mx-auto max-w-xl space-y-5 px-4 py-6">
    <div className="label-controls space-y-4">
      <Link href={`/books/${id}`} className="underline">‹ Back to book</Link>
      <h1 className="text-2xl font-semibold">Print book label</h1>
      <p>2″ wide × 1″ high (50.8 × 25.4 mm)</p>
      {error && <p role="alert" className="text-red-600">{error}</p>}
      {shortened && <p role="status">Long text has been shortened on the label. Review the preview before printing.</p>}
    </div>
    {url && <img className="book-label-image max-w-full border border-slate-300" src={url} width={600} height={300} alt={`Label for ${bookNumber(id)}: ${title}, owner ${owner}`} />}
    <div className="label-controls space-y-4">
      <div className="flex flex-wrap gap-3"><button className={button} disabled={!url} onClick={() => window.print()}>Print label</button>{url && <a className={button} href={url} download={`${bookNumber(id)}-2x1-label.png`}>Download PNG for phone</a>}</div>
      <p className="text-sm"><strong>PC:</strong> Set paper width to 2″ (50.8 mm) and height to 1″ (25.4 mm), margins to none, scale to 100%, and headers and footers off. Check that preview shows exactly one landscape label.</p>
      <p className="text-sm"><strong>Android / PrintLabel:</strong> Download the PNG and import it onto a label 2″ wide × 1″ high (50.8 × 25.4 mm). Fit the entire image inside one label without cropping, stretching, or rotation.</p>
      <p className="text-sm text-slate-500">Print one test label first to check alignment and size.</p>
    </div>
    <style>{`@media print {
      @page { size: ${paperWidth} ${paperHeight}; margin: 0; }
      html, body { width: ${paperWidth} !important; height: ${paperHeight} !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; background: white !important; }
      body > :not(.label-page) { display: none !important; }
      .label-page { display: block !important; width: ${paperWidth} !important; height: ${paperHeight} !important; max-width: none !important; margin: 0 !important; padding: 0 !important; break-inside: avoid; overflow: hidden; }
      .label-controls { display: none !important; }
      .book-label-image { display: block !important; width: ${paperWidth} !important; height: ${paperHeight} !important; max-width: none !important; border: 0 !important; margin: 0 !important; break-inside: avoid; print-color-adjust: exact; }
    }`}</style>
  </main>;
}
