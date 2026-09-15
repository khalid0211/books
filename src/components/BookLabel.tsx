"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { bookNumber } from "@/lib/books";

export default function BookLabel({ id, title, owner, location }: { id: number; title: string; owner: string; location: string }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [shortened, setShortened] = useState(false);
  useEffect(() => {
    try {
      // 600 × 300 pixels gives a 300 dpi image at 2 × 1 inches.
      const canvas = document.createElement("canvas"); canvas.width = 600; canvas.height = 300;
      const ctx = canvas.getContext("2d"); if (!ctx) throw new Error();
      ctx.fillStyle = "white"; ctx.fillRect(0, 0, 600, 300); ctx.fillStyle = "black";
      ctx.textBaseline = "top";
      let clipped = false;
      function line(text: string, y: number, font: string) {
        ctx!.font = font;
        let result = text;
        while (ctx!.measureText(result).width > 552 && result.length) { result = Array.from(result).slice(0, -1).join(""); }
        if (result !== text) {
          clipped = true;
          while (ctx!.measureText(result + "…").width > 552 && result.length) result = Array.from(result).slice(0, -1).join("");
          result += "…";
        }
        ctx!.fillText(result, 24, y);
      }
      line(bookNumber(id), 20, "bold 40px Arial");
      ctx.font = "bold 29px Arial";
      const chars = Array.from(title.replace(/\s+/g, " ").trim());
      let first = "";
      while (chars.length && ctx.measureText(first + chars[0]).width <= 552) first += chars.shift();
      // Prefer wrapping between words when the first line contains a space.
      if (chars.length && first.lastIndexOf(" ") > 0) {
        const cut = first.lastIndexOf(" "); chars.unshift(...Array.from(first.slice(cut + 1))); first = first.slice(0, cut);
      }
      line(first, 80, "bold 29px Arial");
      line(chars.join("").trim(), 116, "bold 29px Arial");
      line(`Owner: ${owner}`, 180, "27px Arial");
      line(`Shelf: ${location}`, 224, "27px Arial");
      setShortened(clipped); setUrl(canvas.toDataURL("image/png"));
    } catch { setError("Could not prepare the label. Reload to try again."); }
  }, [id, title, owner, location]);
  const button = "inline-block rounded-lg bg-slate-900 px-4 py-3 text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900";
  return <main className="label-page mx-auto max-w-xl space-y-5 px-4 py-6">
    <div className="label-controls space-y-4">
      <Link href={`/books/${id}`} className="underline">‹ Back to book</Link>
      <h1 className="text-2xl font-semibold">Print book label</h1>
      <p>2″ wide × 1″ high (50.8 × 25.4 mm)</p>
      {error && <p role="alert" className="text-red-600">{error}</p>}
      {shortened && <p role="status">Long text has been shortened on the label. Review the preview before printing.</p>}
    </div>
    {url && <img className="book-label-image max-w-full border border-slate-300" src={url} width={600} height={300} alt={`Label for ${bookNumber(id)}: ${title}, owner ${owner}, shelf ${location}`} />}
    <div className="label-controls space-y-4">
      <div className="flex flex-wrap gap-3"><button className={button} disabled={!url} onClick={() => window.print()}>Print label</button>{url && <a className={button} href={url} download={`${bookNumber(id)}-2x1-label.png`}>Download PNG for phone</a>}</div>
      <p className="text-sm"><strong>PC:</strong> Select the installed label printer, set paper to 50.8 × 25.4 mm, scale to 100%, and turn off headers and footers. USB or Bluetooth must be supported by its Windows driver.</p>
      <p className="text-sm"><strong>Android / PrintLabel:</strong> Download the PNG. If PrintLabel offers image import, add it to a 50.8 × 25.4 mm label, fill the label with the image without cropping, then print using the printer connected in PrintLabel. Direct Bluetooth printing from this website is not configured.</p>
      <p className="text-sm text-slate-500">Print one test label first to check alignment and size.</p>
    </div>
    <style>{`@media print {
      @page { size: 50.8mm 25.4mm; margin: 0; }
      html, body { width: 50.8mm !important; height: 25.4mm !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; background: white !important; }
      body > :not(.label-page) { display: none !important; }
      .label-page { display: block !important; width: 50.8mm !important; max-width: none !important; margin: 0 !important; padding: 0 !important; }
      .label-controls { display: none !important; }
      .book-label-image { display: block !important; width: 50.8mm !important; height: 25.4mm !important; max-width: none !important; border: 0 !important; margin: 0 !important; print-color-adjust: exact; }
    }`}</style>
  </main>;
}
