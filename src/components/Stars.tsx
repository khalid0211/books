export default function Stars({ value }: { value: number | null }) {
  if (!value) return <span className="text-slate-400">—</span>;
  const v = Math.max(0, Math.min(5, value));
  return (
    <span aria-label={`${v} out of 5`} className="text-amber-500">
      {"★".repeat(v)}
      <span className="text-slate-300 dark:text-slate-600">{"★".repeat(5 - v)}</span>
    </span>
  );
}
