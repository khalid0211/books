"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  FIELD_DEFS,
  emptyBookInput,
  type Book,
  type BookInput,
  type FieldDef,
} from "@/lib/books";

type Props = { initial?: Book };

function toFormValue(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

export default function BookForm({ initial }: Props) {
  const router = useRouter();
  const isEdit = Boolean(initial);

  const [values, setValues] = useState<Record<string, string>>(() => {
    const base = initial ?? emptyBookInput();
    const out: Record<string, string> = {};
    for (const f of FIELD_DEFS) out[f.name] = toFormValue((base as Record<string, unknown>)[f.name]);
    return out;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(name: string, value: string) {
    setValues((v) => ({ ...v, [name]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    // Build payload: "" becomes null, except title/authors stay as strings.
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

  return (
    <div className="mx-auto max-w-xl px-4 pb-28 md:pb-10">
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
