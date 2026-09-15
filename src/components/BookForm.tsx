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

type Props = { initial?: Book; canDelete?: boolean };

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

export default function BookForm({ initial, canDelete = false }: Props) {
  const router = useRouter();
  const isEdit = Boolean(initial);
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
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setSaveNote("Changes saved.");
      router.push(isEdit ? `/books/${initial!.id}` : "/");
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
      router.push("/");
      router.refresh();
    } else {
      setError("Failed to delete");
      setSaving(false);
    }
  }

  const canLookup = isValidIsbn(isbn);

  return (
    <div className="mx-auto max-w-xl px-4 pb-28 md:pb-10">
      {initial && <Link href={`/books/${initial.id}/label`} className="my-3 inline-block underline">Print label (saved book)</Link>}
      {scanning && <IsbnScanner onDetected={onScanDetected} onClose={() => setScanning(false)} />}

      <header className="sticky top-0 z-10 -mx-4 mb-4 flex items-center gap-3 border-b border-slate-200 bg-slate-50/90 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
        <Link href={isEdit ? `/books/${initial!.id}` : "/"} className="text-slate-500 hover:text-slate-900 dark:hover:text-slate-100">
          ‹ Back
        </Link>
        <h1 className="text-lg font-semibold">{isEdit ? "Edit book" : "Add book"}</h1>
      </header>
      <p className="mb-4 text-sm text-slate-500">
        Book number: {initial ? <span className="font-mono font-semibold">{bookNumber(initial.id)}</span> : "Assigned automatically when saved"}
      </p>

      {error && (
        <p className="mb-3 rounded-lg bg-red-100 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}

      {/* Find by ISBN */}
      <div className="mb-5 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-800">
        <label htmlFor="book-isbn" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
          ISBN (optional)
        </label>
        <div className="flex items-center gap-2">
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
            className="shrink-0 rounded-lg bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
          >
            {lookupBusy ? "…" : "Look up"}
          </button>
        </div>
        <button
          type="button"
          onClick={() => setScanning(true)}
          disabled={lookupBusy}
          className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-3 text-sm font-medium hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:hover:bg-slate-700"
        >
          📷 Scan barcode
        </button>
        {lookupBusy && (
          <div role="status" className="mt-3 flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-3 text-sm text-slate-700 dark:bg-slate-900 dark:text-slate-200">
            <span aria-hidden="true" className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-slate-400 border-t-transparent motion-reduce:animate-none" />
            Fetching book info…
          </div>
        )}
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Type the ISBN and tap “Look up”, or scan the barcode. Open Library &amp; Google Books
          fill the rest.
        </p>
        {lookupErr && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{lookupErr}</p>}
        {lookupNote && <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">{lookupNote}</p>}
      </div>

      <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <p className="text-sm text-slate-500 sm:col-span-2">Only title is required. All other details are optional.</p>
        {FIELD_DEFS.filter((f) => MAIN_FIELDS.includes(f.name) && f.name !== "shelfLocation").map((f) => (
          <Field key={f.name} def={f} value={values[f.name]} onChange={(v) => set(f.name, v)} />
        ))}
        <div className="sm:col-span-2">
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
        <div className="sm:col-span-2">
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
        <details className="rounded-xl border border-slate-200 p-4 sm:col-span-2 dark:border-slate-700">
          <summary className="cursor-pointer font-medium">More details</summary>
        {values.coverImageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={values.coverImageUrl}
            alt="Cover preview"
            className="mt-3 h-28 w-auto rounded border border-slate-200 dark:border-slate-700"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
            onLoad={(e) => {
              e.currentTarget.style.display = "";
            }}
          />
        )}
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium">{values.coverImageUrl ? "Change cover" : "Add cover"}</summary>
          <div className="mt-2">
            <Field def={FIELD_DEFS.find((f) => f.name === "coverImageUrl")!} value={values.coverImageUrl} onChange={(v) => set("coverImageUrl", v)} />
          </div>
        </details>
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
        </details>

        <details className="rounded-xl border border-slate-200 p-4 sm:col-span-2 dark:border-slate-700">
          <summary className="cursor-pointer font-medium">Review &amp; purchase details</summary>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {REVIEW_FIELDS.map((name) => {
              const f = FIELD_DEFS.find((field) => field.name === name)!;
              return <Field key={f.name} def={f.name === "notes" ? { ...f, label: "Review" } : f} value={values[f.name]} onChange={(v) => set(f.name, v)} />;
            })}
          </div>
        </details>

        {/* Action bar: sticky on mobile, inline on desktop */}
        {saveNote && <p role="status" className="text-sm text-emerald-700 sm:col-span-2 dark:text-emerald-400">{saveNote}</p>}
        <div className="safe-bottom fixed inset-x-0 bottom-0 z-20 flex gap-3 border-t border-slate-200 bg-slate-50/95 px-4 py-3 backdrop-blur sm:static sm:col-span-2 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:backdrop-blur-none dark:border-slate-800 dark:bg-slate-900/95 sm:dark:bg-transparent">
          <button
            type="submit"
            disabled={saving}
            className="flex-1 rounded-lg bg-slate-900 px-4 py-3 font-medium text-white hover:bg-slate-700 disabled:opacity-50 sm:flex-none dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
          >
            {saving ? "Saving…" : isEdit ? "Save changes" : "Add book"}
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
      </form>
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
