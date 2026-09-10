"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  FIELD_DEFS,
  emptyBookInput,
  type Book,
  type BookInput,
  type FieldDef,
} from "@/lib/books";
import { cleanIsbn, isValidIsbn, type LookupResult } from "@/lib/isbn";
import IsbnScanner from "@/components/IsbnScanner";

type Props = { initial?: Book };

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

export default function BookForm({ initial }: Props) {
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
  const [error, setError] = useState<string | null>(null);

  const [scanning, setScanning] = useState(false);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupNote, setLookupNote] = useState<string | null>(null);
  const [lookupErr, setLookupErr] = useState<string | null>(null);

  function set(name: string, value: string) {
    setValues((v) => ({ ...v, [name]: value }));
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
    const start = base ?? values;
    const isbn = cleanIsbn(isbnArg ?? start.isbn13 ?? start.isbn10 ?? "");
    setLookupNote(null);
    setLookupErr(null);
    if (!isValidIsbn(isbn)) {
      setLookupErr("Enter or scan a valid ISBN-13 (or ISBN-10) first.");
      return;
    }
    setLookupBusy(true);
    try {
      const res = await fetch(`/api/lookup?isbn=${encodeURIComponent(isbn)}`);
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
      setLookupBusy(false);
    }
  }

  function onScanDetected(isbn: string) {
    setScanning(false);
    const base = { ...values };
    if (isbn.length === 13) base.isbn13 = isbn;
    if (isbn.length === 10 && !base.isbn10) base.isbn10 = isbn;
    setValues(base);
    void runLookup(isbn, base);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
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
      router.push(isEdit ? `/books/${initial!.id}` : "/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
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

  const canLookup = isValidIsbn(cleanIsbn(values.isbn13 || values.isbn10 || ""));

  return (
    <div className="mx-auto max-w-xl px-4 pb-28 md:pb-10">
      {scanning && <IsbnScanner onDetected={onScanDetected} onClose={() => setScanning(false)} />}

      <header className="sticky top-0 z-10 -mx-4 mb-4 flex items-center gap-3 border-b border-slate-200 bg-slate-50/90 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
        <Link href={isEdit ? `/books/${initial!.id}` : "/"} className="text-slate-500 hover:text-slate-900 dark:hover:text-slate-100">
          ‹ Back
        </Link>
        <h1 className="text-lg font-semibold">{isEdit ? "Edit book" : "Add book"}</h1>
      </header>

      {error && (
        <p className="mb-3 rounded-lg bg-red-100 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}

      {/* Find by ISBN */}
      <div className="mb-5 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-800">
        <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
          ISBN
        </label>
        <div className="flex items-center gap-2">
          <input
            type="text"
            inputMode="numeric"
            value={values.isbn13}
            onChange={(e) => set("isbn13", e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void runLookup();
              }
            }}
            placeholder="Type or paste ISBN-13"
            className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-3 text-base outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-900"
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
          className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-3 text-sm font-medium hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700"
        >
          📷 Scan barcode
        </button>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Type the ISBN and tap “Look up”, or scan the barcode. Open Library &amp; Google Books
          fill the rest.
        </p>
        {lookupErr && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{lookupErr}</p>}
        {lookupNote && <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">{lookupNote}</p>}
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
      </div>

      <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {FIELD_DEFS.map((f) => (
          <Field key={f.name} def={f} value={values[f.name]} onChange={(v) => set(f.name, v)} />
        ))}

        {/* Action bar: sticky on mobile, inline on desktop */}
        <div className="safe-bottom fixed inset-x-0 bottom-0 z-20 flex gap-3 border-t border-slate-200 bg-slate-50/95 px-4 py-3 backdrop-blur sm:static sm:col-span-2 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:backdrop-blur-none dark:border-slate-800 dark:bg-slate-900/95 sm:dark:bg-transparent">
          <button
            type="submit"
            disabled={saving}
            className="flex-1 rounded-lg bg-slate-900 px-4 py-3 font-medium text-white hover:bg-slate-700 disabled:opacity-50 sm:flex-none dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
          >
            {saving ? "Saving…" : isEdit ? "Save changes" : "Add book"}
          </button>
          {isEdit && (
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
