"use client";
import { useState } from "react";
import { BOOK_TYPES, type CategoryChoice, type Classification } from "@/lib/classification";

export default function ClassificationPicker({ categories, value, onChange, disabled = false }: { categories: CategoryChoice[]; value: Classification; onChange: (value: Classification) => void; disabled?: boolean }) {
  const [query, setQuery] = useState("");
  return <fieldset disabled={disabled} className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
    <legend className="px-1 font-semibold">Classification</legend>
    <label className="block text-sm">Type<select value={value.bookType || ""} onChange={(e) => onChange({ ...value, bookType: e.target.value || null })} className="mt-1 w-full rounded-lg border bg-white p-3 dark:bg-slate-800"><option value="">Unclassified</option>{BOOK_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>
    <label className="block text-sm">Categories · select any that apply<input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a category…" className="mt-1 w-full rounded-lg border bg-white p-3 dark:bg-slate-800" /></label>
    <div className="flex max-h-56 flex-wrap gap-2 overflow-y-auto">{categories.filter((c) => c.name.toLowerCase().includes(query.toLowerCase())).map((c) => <label key={c.id} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${value.categoryIds.includes(c.id) ? "border-teal-600 bg-teal-50 text-teal-900 dark:bg-teal-950 dark:text-teal-100" : "border-slate-200 dark:border-slate-700"}`}><input type="checkbox" checked={value.categoryIds.includes(c.id)} onChange={(e) => onChange({ ...value, categoryIds: e.target.checked ? [...value.categoryIds, c.id] : value.categoryIds.filter((id) => id !== c.id) })} />{c.name}</label>)}</div>
    <p className="text-xs text-slate-500">{value.categoryIds.length} selected{!categories.length ? " · Add categories using Manage categories." : ""}</p>
  </fieldset>;
}
