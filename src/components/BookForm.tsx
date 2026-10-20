"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  FIELD_DEFS,
  bookNumber,
  emptyBookInput,
  type Book,
  type BookInput,
  type FieldDef,
} from "@/lib/books";
import { cleanIsbn, isValidIsbn, type LookupResult } from "@/lib/isbn";
import IsbnScanner from "@/components/IsbnScanner";
import { flattenLocations } from "@/lib/locations";
import ClassificationPicker from "@/components/ClassificationPicker";
import BookEnrichmentPanel from "@/components/BookEnrichmentPanel";
import RelatedBooks from "@/components/RelatedBooks";
import { suggestClassification, type CategoryChoice, type Classification } from "@/lib/classification";

type Props = { initial?: Book; canDelete?: boolean; returnTo?: string };

const BOOK_TABS = [{ id: "details", label: "Book details" }, { id: "publication", label: "Publication & review" }, { id: "insights", label: "AI insights" }, { id: "related", label: "Related books" }] as const;
type BookTab = typeof BOOK_TABS[number]["id"];

const MAIN_FIELDS = ["title", "authors", "tags", "shelfLocation"];
const DETAIL_FIELDS = ["publisher", "publicationDate", "edition", "language", "pageCount", "format"];
const REVIEW_FIELDS = ["rating", "notes", "price", "dateAcquired"];

function toFormValue(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

// Fields that /api/lookup can populate, in display order.
const LOOKUP_FIELDS: (keyof BookInput)[] = [
  "title",
  "authors",
  "isbn13",
  "isbn10",
  "publisher",
  "publicationDate",
  "pageCount",
  "language",
  "tags",
  "coverImageUrl",
];

export default function BookForm({ initial, canDelete = false, returnTo = "/" }: Props) {
  const router = useRouter();
  const isEdit = Boolean(initial);
  const [activeTab, setActiveTab] = useState<BookTab>("details");
  const [categories, setCategories] = useState<CategoryChoice[]>([]);
  const [classification, setClassification] = useState<Classification>({ bookType: initial?.bookType || null, categoryIds: initial?.categories?.map((c) => c.id) || [] });
  const [subjects, setSubjects] = useState<string[] | null>(null);
  const [categoryError, setCategoryError] = useState("");
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/categories", { cache: "no-store" });
        if (!res.ok) throw new Error("Could not load categories. Reload to try again.");
        setCategories(await res.json()); setCategoryError("");
      } catch (e) { setCategoryError(e instanceof Error ? e.message : "Could not load categories."); }
    }
    void load(); window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, []);
  const suggestion = subjects ? suggestClassification(subjects, categories) : null;
  const labelFor = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of FIELD_DEFS) m.set(f.name, f.label);
    return m;
  }, []);

  const [values, setValues] = useState<Record<string, string>>(() => {
    const base = initial ?? emptyBookInput();
    const out: Record<string, string> = {};
    for (const f of FIELD_DEFS) out[f.name] = toFormValue((base as Record<string, unknown>)[f.name]);
    return out;
  });
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [locations, setLocations] = useState<ReturnType<typeof flattenLocations>>([]);
  const [locationsError, setLocationsError] = useState(false);
  useEffect(() => {
    async function loadLocations() {
      try {
        const res = await fetch("/api/locations", { cache: "no-store" });
        if (!res.ok) throw new Error("Location lookup failed");
        setLocations(flattenLocations(await res.json()));
        setLocationsError(false);
      } catch { setLocationsError(true); }
    }
    void loadLocations();
    window.addEventListener("focus", loadLocations);
    return () => window.removeEventListener("focus", loadLocations);
  }, []);
  const [owners, setOwners] = useState<{ id: number; name: string }[]>([]);
  const [ownersError, setOwnersError] = useState(false);
  useEffect(() => {
    async function loadOwners() {
      try {
        const res = await fetch("/api/owners", { cache: "no-store" });
        if (!res.ok) throw new Error();
        setOwners(await res.json()); setOwnersError(false);
      } catch { setOwnersError(true); }
    }
    void loadOwners(); window.addEventListener("focus", loadOwners);
    return () => window.removeEventListener("focus", loadOwners);
  }, []);
  const [isbn, setIsbn] = useState(initial?.isbn13 || initial?.isbn10 || "");
  const [error, setError] = useState<string | null>(null);

  const [scanning, setScanning] = useState(false);
  const [lookupBusy, setLookupBusy] = useState(false);
  const lookupInFlight = useRef(false);
  const [lookupNote, setLookupNote] = useState<string | null>(null);
  const [lookupErr, setLookupErr] = useState<string | null>(null);

  function set(name: string, value: string) {
    setValues((v) => ({ ...v, [name]: value }));
  }

  function updateIsbn(raw: string) {
    setIsbn(raw);
    const cleaned = cleanIsbn(raw);
    setValues((v) => ({ ...v, isbn10: cleaned.length === 10 ? cleaned : "", isbn13: cleaned.length === 10 ? "" : cleaned }));
  }

  /**
   * Fill empty fields from a lookup result; returns the labels that were filled.
   * Computed synchronously from `current` (defaults to state) so the caller can
   * report what changed.
   */
  function applyLookup(r: LookupResult, current: Record<string, string> = values): string[] {
    const filled: string[] = [];
    const next = { ...current };
    for (const key of LOOKUP_FIELDS) {
      const incoming = r[key as keyof LookupResult];
      if (incoming == null || incoming === "") continue;
      if (next[key]?.trim()) continue; // keep whatever the user already typed
      next[key] = String(incoming);
      filled.push(labelFor.get(key) ?? key);
    }
    setValues(next);
    return filled;
  }

  async function runLookup(isbnArg?: string, base?: Record<string, string>) {
    if (lookupInFlight.current) return;
    const start = base ?? values;
    const lookupIsbn = cleanIsbn(isbnArg ?? isbn);
    setLookupNote(null);
    setLookupErr(null);
    if (!isValidIsbn(lookupIsbn)) {
      setLookupErr("Enter or scan a valid ISBN-13 (or ISBN-10) first.");
      return;
    }
    lookupInFlight.current = true;
    setLookupBusy(true);
    try {
      const res = await fetch(`/api/lookup?isbn=${encodeURIComponent(lookupIsbn)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Lookup failed (${res.status})`);
      const result = data as LookupResult;
      setSubjects(result.subjects || (result.tags ? result.tags.split(",") : []));
      const filled = applyLookup(result, start);
      const src = result.sources?.join(" + ") || "the web";
      setLookupNote(
        filled.length
          ? `Filled from ${src}: ${filled.join(", ")}. Review, then save.`
          : `Found in ${src}, but every matching field already had a value.`,
      );
    } catch (err) {
      setLookupErr(err instanceof Error ? err.message : "Lookup failed");
    } finally {
      lookupInFlight.current = false;
      setLookupBusy(false);
    }
  }

  function onScanDetected(isbn: string) {
    setScanning(false);
    setIsbn(isbn);
    const base = { ...values, isbn10: "", isbn13: "" };
    if (isbn.length === 13) base.isbn13 = isbn;
    if (isbn.length === 10 && !base.isbn10) base.isbn10 = isbn;
    setValues(base);
    void runLookup(isbn, base);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaveNote(null);
    if (isbn.trim() && !isValidIsbn(isbn)) {
      setActiveTab("details");
      setError("Enter a valid ISBN-10 or ISBN-13, or leave ISBN empty.");
      return;
    }
    setSaving(true);
    setError(null);

    const payload: Partial<BookInput> = {};
    for (const f of FIELD_DEFS) {
      const raw = values[f.name].trim();
      (payload as Record<string, unknown>)[f.name] = raw === "" ? null : raw;
    }

    const url = isEdit ? `/api/books/${initial!.id}` : "/api/books";
    const method = isEdit ? "PUT" : "POST";

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, ...classification }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setSaveNote("Changes saved.");
      router.push(returnTo);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!initial) return;
    if (!confirm(`Delete "${initial.title}"? This cannot be undone.`)) return;
    setSaving(true);
    const res = await fetch(`/api/books/${initial.id}`, { method: "DELETE" });
    if (res.ok) {
      router.push(returnTo);
      router.refresh();
    } else {
      setError("Failed to delete");
      setSaving(false);
    }
  }

  const canLookup = isValidIsbn(isbn);

  return (
    <div className="desktop-book-form mx-auto max-w-xl px-4 pb-28 md:max-w-7xl md:px-8 md:pb-10">
      {scanning && <IsbnScanner onDetected={onScanDetected} onClose={() => setScanning(false)} />}

      <header className="book-form-header sticky top-0 z-10 -mx-4 mb-6 flex items-center justify-between gap-4 border-b border-slate-200 bg-slate-50/95 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        <div className="min-w-0">
          <Link href={returnTo} className="text-sm text-slate-500 hover:text-teal-700 dark:hover:text-teal-300">‹ Back to catalogue</Link>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-lg font-semibold">{isEdit ? "Edit book" : "Add book"}</h1>
            {initial && <span className="rounded-md border border-slate-200 px-2 py-1 font-mono text-xs text-slate-500 dark:border-slate-700">{bookNumber(initial.id)}</span>}
          </div>
          {!initial && <p className="mt-1 text-xs text-slate-500">Book number assigned when saved</p>}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {initial && <Link href={`/books/${initial.id}/label`} className="hidden rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-white md:inline-block dark:border-slate-600 dark:hover:bg-slate-800">Print label</Link>}
          <button type="submit" form="book-details-form" disabled={saving} className="hidden rounded-lg bg-teal-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50 md:inline-block dark:bg-teal-300 dark:text-slate-950 dark:hover:bg-teal-200">{saving ? "Saving…" : isEdit ? "Save book details" : "Add book"}</button>
        </div>
      </header>
      {initial && <Link href={`/books/${initial.id}/label`} className="mb-4 inline-block text-sm underline md:hidden">Print label</Link>}

      {error && (
        <p role="alert" className="mb-3 rounded-lg bg-red-100 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}

      <nav aria-label="Book sections" className="mb-5 overflow-x-auto border-b border-slate-200 dark:border-slate-700">
        <div role="tablist" aria-label="Book information" className="flex min-w-max gap-1">
          {BOOK_TABS.filter(tab => initial || tab.id === "details" || tab.id === "publication").map(tab => <button
            key={tab.id} id={`book-tab-${tab.id}`} type="button" role="tab"
            aria-selected={activeTab === tab.id} aria-controls={`book-panel-${tab.id}`} tabIndex={activeTab === tab.id ? 0 : -1}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={event => {
              const tabs = BOOK_TABS.filter(t => initial || t.id === "details" || t.id === "publication");
              const index = tabs.findIndex(t => t.id === tab.id);
              const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
              if (next !== null) { event.preventDefault(); setActiveTab(tabs[next].id); document.getElementById(`book-tab-${tabs[next].id}`)?.focus(); }
            }}
            className={`border-b-2 px-4 py-3 text-sm font-medium transition-colors ${activeTab === tab.id ? "border-teal-700 text-teal-800 dark:border-teal-300 dark:text-teal-200" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800 dark:hover:text-slate-200"}`}
          >{tab.label}</button>)}
        </div>
      </nav>
      <form id="book-details-form" onSubmit={onSubmit} onInvalidCapture={event => {
        event.preventDefault();
        const input = event.target as HTMLInputElement;
        const panel = input.closest<HTMLElement>("[data-book-tab]");
        if (panel?.dataset.bookTab) setActiveTab(panel.dataset.bookTab as BookTab);
        setError(input.validationMessage);
        requestAnimationFrame(() => input.focus());
      }}>
        <div id="book-panel-details" role="tabpanel" aria-labelledby="book-tab-details" data-book-tab="details" hidden={activeTab !== "details"}>
      {/* Find by ISBN */}
      <div className="book-lookup mb-6 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <div className="book-lookup-heading"><h2 className="mb-1 font-semibold">Find book details</h2>
        <label htmlFor="book-isbn" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
          ISBN (optional)
        </label></div>
        <div className="book-lookup-controls flex flex-wrap items-center gap-2">
          <input
            type="text"
            id="book-isbn"
            value={isbn}
            onChange={(e) => updateIsbn(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void runLookup();
              }
            }}
            placeholder="ISBN-10 or ISBN-13"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-3 text-base outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-900"
          />
          <button
            type="button"
            onClick={() => runLookup()}
            disabled={!canLookup || lookupBusy}
            className="shrink-0 rounded-lg bg-teal-700 px-4 py-3 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-40 dark:bg-teal-300 dark:text-slate-950 dark:hover:bg-teal-200"
          >
            {lookupBusy ? "…" : "Look up"}
          </button>
        <button
          type="button"
          onClick={() => setScanning(true)}
          disabled={lookupBusy}
          className="w-full shrink-0 rounded-lg border border-slate-300 px-3 py-3 text-sm font-medium hover:bg-slate-100 disabled:opacity-40 lg:w-auto dark:border-slate-600 dark:hover:bg-teal-800"
        >
          📷 Scan barcode
        </button></div>
        {lookupBusy && (
          <div role="status" className="mt-3 flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-3 text-sm text-slate-700 dark:bg-teal-700 dark:text-slate-200">
            <span aria-hidden="true" className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-slate-400 border-t-transparent motion-reduce:animate-none" />
            Fetching book info…
          </div>
        )}
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Look up an ISBN or scan a barcode to fill empty fields from Open Library and Google Books.
        </p>
        {lookupErr && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{lookupErr}</p>}
        {lookupNote && <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">{lookupNote}</p>}
      </div>

          <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)]">
            <div className="min-w-0 space-y-5">
          <section aria-labelledby="book-details-heading" className="book-form-card">
            <h2 id="book-details-heading" className="font-semibold">Book details</h2>
            <p className="mb-5 mt-1 text-sm text-slate-500">Only the title is required.</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {FIELD_DEFS.filter((f) => MAIN_FIELDS.includes(f.name) && f.name !== "shelfLocation").map((f) => (
          <Field key={f.name} def={f} value={values[f.name]} onChange={(v) => set(f.name, v)} />
        ))}
            </div>
          </section>
        <div className="book-form-card space-y-3">
          <ClassificationPicker categories={categories} value={classification} onChange={setClassification} disabled={saving} />
          <Link href="/categories" target="_blank" rel="noopener noreferrer" className="inline-block text-sm underline">Manage categories (new tab)</Link>
          {categoryError && <p role="alert" className="text-sm text-red-600">{categoryError}</p>}
          {suggestion && <div className="rounded-xl border border-teal-300 bg-teal-50 p-4 text-sm text-teal-900 dark:bg-teal-950 dark:text-teal-100"><p className="font-semibold">Suggested from book lookup</p><p className="mt-1">{[suggestion.bookType, ...categories.filter((c) => suggestion.categoryIds.includes(c.id)).map((c) => c.name)].filter(Boolean).join(" · ") || "No matching categories found. Choose manually above."}</p>{(suggestion.bookType || suggestion.categoryIds.length > 0) && <button type="button" disabled={saving} className="mt-3 rounded-lg border border-teal-600 px-3 py-2" onClick={() => { setClassification((value) => ({ bookType: value.bookType || suggestion.bookType, categoryIds: value.categoryIds.length ? value.categoryIds : suggestion.categoryIds })); setSubjects(null); }}>Use suggestions for empty fields</button>}<p className="mt-2 text-xs">Your existing selections are kept. Review before saving.</p></div>}
        </div>
          <section aria-labelledby="library-heading" className="book-form-card grid grid-cols-1 gap-5 sm:grid-cols-2">
            <h2 id="library-heading" className="font-semibold sm:col-span-2">In your library</h2>
        <div>
          <label className="block text-sm font-medium" htmlFor="book-location">Shelf location</label>
          <select id="book-location" value={values.shelfLocation} onChange={(e) => set("shelfLocation", e.target.value)} className="mt-1 min-h-12 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-3 text-base dark:border-slate-700 dark:bg-slate-800">
            <option value="">No location assigned</option>
            {values.shelfLocation && !locations.some((location) => location.code === values.shelfLocation) && <option value={values.shelfLocation}>{values.shelfLocation} (current location)</option>}
            {locations.map((location) => <option key={location.code} value={location.code}>{location.code} — {location.label}</option>)}
          </select>
          <details className="mt-2">
            <summary className="cursor-pointer text-sm underline">Enter a location code manually</summary>
            <label htmlFor="book-location-code" className="mt-2 block text-sm">Location code</label>
            <input id="book-location-code" value={values.shelfLocation} onChange={(e) => set("shelfLocation", e.target.value)} placeholder="ST-C02-S03" autoCapitalize="characters" spellCheck={false} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-base dark:border-slate-700 dark:bg-slate-800" />
          </details>
          <p className="mt-1 text-sm text-slate-500">{locations.find((location) => location.code === values.shelfLocation)?.label}</p>
          {locationsError && <p role="status" className="mt-1 text-sm text-red-600">Could not load location choices. Your existing location is preserved; return to this window to retry.</p>}
          <Link href="/locations" target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm underline">Manage locations (new tab)</Link>
        </div>
        <div>
          <label className="block text-sm font-medium">Book owner
            <select value={values.ownerId} onChange={(e) => set("ownerId", e.target.value)} className="mt-1 w-full rounded-lg border bg-white p-3 dark:bg-slate-800">
              <option value="">Unassigned</option>
              {values.ownerId && !owners.some((o) => String(o.id) === values.ownerId) && <option value={values.ownerId}>{initial?.owner?.name || "Current owner"}</option>}
              {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
          {ownersError && <p role="alert" className="text-sm text-red-600">Could not load book owners. Return to this window to retry.</p>}
          <Link href="/owners" target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm underline">Manage book owners (new tab)</Link>
        </div>
          </section>
            </div>
            <aside aria-label="Book cover" className="min-w-0">
          <section aria-labelledby="cover-heading" className="book-form-card">
            <h2 id="cover-heading" className="mb-4 font-semibold">Book cover</h2>
        {values.coverImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={values.coverImageUrl}
            alt={values.title ? `Cover of ${values.title}` : "Cover preview"}
            className="mx-auto max-h-56 max-w-full rounded-lg border border-slate-200 object-contain shadow-sm dark:border-slate-700"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
            onLoad={(e) => {
              e.currentTarget.style.display = "";
            }}
          />
        ) : <div className="flex h-32 items-center justify-center rounded-lg bg-slate-100 text-sm text-slate-500 dark:bg-slate-900">No cover image</div>}
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium">{values.coverImageUrl ? "Change cover" : "Add cover"}</summary>
          <div className="mt-2">
            <Field def={FIELD_DEFS.find((f) => f.name === "coverImageUrl")!} value={values.coverImageUrl} onChange={(v) => set("coverImageUrl", v)} />
          </div>
        </details>
          </section>
            </aside>
          </div>
        </div>
        <div id="book-panel-publication" role="tabpanel" aria-labelledby="book-tab-publication" data-book-tab="publication" hidden={activeTab !== "publication"}>
          <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <section aria-labelledby="publication-heading" className="book-form-card">
          <h2 id="publication-heading" className="font-semibold">Publication details</h2>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {FIELD_DEFS.filter((f) => DETAIL_FIELDS.includes(f.name)).map((f) => (
              <Field
                key={f.name}
                def={f.name === "publicationDate" ? { ...f, label: "Publication year", type: "number", min: 1, max: 9999, step: "1" } : f}
                value={f.name === "publicationDate" ? values[f.name].slice(0, 4) : values[f.name]}
                onChange={(v) => set(f.name, v)}
              />
            ))}
          </div>
        </section>

        <section className="book-form-card">
          <h2 className="font-semibold">Review &amp; purchase details</h2>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {REVIEW_FIELDS.map((name) => {
              const f = FIELD_DEFS.find((field) => field.name === name)!;
              return <Field key={f.name} def={f.name === "notes" ? { ...f, label: "Review" } : f} value={values[f.name]} onChange={(v) => set(f.name, v)} />;
            })}
          </div>
        </section>

          </div>
        </div>
      </form>
      {initial && <>
        <div id="book-panel-insights" role="tabpanel" aria-labelledby="book-tab-insights" hidden={activeTab !== "insights"} className="book-enrichment-layout">{canDelete && <p className="mb-4 text-sm text-slate-500">Use “Save corrections and publish” below to save edits to AI insights. “Save book details” saves the catalogue fields on the first two tabs.</p>}<BookEnrichmentPanel bookId={initial.id} owner={canDelete} returnTo={returnTo} showRelated={false} /></div>
        <div id="book-panel-related" role="tabpanel" aria-labelledby="book-tab-related" hidden={activeTab !== "related"} className="book-enrichment-layout"><RelatedBooks bookId={initial.id} returnTo={returnTo} /></div>
      </>}
      <div className="mt-6">
        {/* Action bar: sticky on mobile, inline on desktop */}
        {saveNote && <p role="status" className="text-sm text-emerald-700 lg:col-span-2 dark:text-emerald-400">{saveNote}</p>}
        <div className="safe-bottom fixed inset-x-0 bottom-0 z-20 flex gap-3 border-t border-slate-200 bg-slate-50/95 px-4 py-3 backdrop-blur sm:static lg:col-span-2 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:backdrop-blur-none dark:border-slate-800 dark:bg-slate-900/95 sm:dark:bg-transparent">
          <button
            type="submit" form="book-details-form"
            disabled={saving}
            className="flex-1 rounded-lg bg-teal-700 px-4 py-3 font-medium text-white hover:bg-teal-800 disabled:opacity-50 sm:flex-none dark:bg-teal-300 dark:text-slate-950 dark:hover:bg-teal-200"
          >
            {saving ? "Saving…" : isEdit ? "Save book details" : "Add book"}
          </button>
          {isEdit && canDelete && (
            <button
              type="button"
              onClick={onDelete}
              disabled={saving}
              className="rounded-lg px-4 py-3 font-medium text-red-600 hover:bg-red-100 disabled:opacity-50 dark:hover:bg-red-950"
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  def,
  value,
  onChange,
}: {
  def: FieldDef;
  value: string;
  onChange: (v: string) => void;
}) {
  const wrap = def.half ? "sm:col-span-1" : "sm:col-span-2";
  const inputClass =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-base outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-800";

  if (def.name === "rating") {
    return (
      <fieldset className="sm:col-span-2">
        <legend className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-300">Rating</legend>
        <div className="flex flex-wrap items-center gap-1">
          {[1, 2, 3, 4, 5].map((rating) => (
            <label key={rating} className="cursor-pointer">
              <input
                type="radio"
                name="rating"
                value={rating}
                checked={Number(value) === rating}
                onChange={() => onChange(String(rating))}
                aria-label={`${rating} ${rating === 1 ? "star" : "stars"}`}
                className="peer sr-only"
              />
              <span aria-hidden="true" className={`flex h-11 w-11 items-center justify-center rounded-lg text-3xl peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-slate-500 ${rating <= Number(value) ? "text-amber-500" : "text-slate-300 dark:text-slate-600"}`}>★</span>
            </label>
          ))}
          <span className="ml-2 text-sm text-slate-500">{value ? `${value} / 5` : "Not rated"}</span>
          {value && <button type="button" onClick={() => onChange("")} className="rounded-lg px-3 py-2 text-sm text-slate-500 underline">Clear</button>}
        </div>
      </fieldset>
    );
  }

  return (
    <label className={`block ${wrap}`}>
      <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
        {def.label}
        {def.required && <span className="text-red-500"> *</span>}
      </span>
      {def.type === "textarea" ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
          className={inputClass}
        />
      ) : def.type === "select" ? (
        <select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
          <option value="">—</option>
          {def.options?.map((o) => (
            <option key={o} value={o} className="capitalize">
              {o}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={def.type === "url" ? "url" : def.type}
          value={value}
          required={def.required}
          placeholder={def.placeholder}
          min={def.min}
          max={def.max}
          step={def.step}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        />
      )}
    </label>
  );
}
