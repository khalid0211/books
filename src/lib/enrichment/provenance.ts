export type EnrichmentSourceType = "open_library_description" | "ai_model_knowledge";
type SourceRecord = { sourceType?: string | null; olDescription: string | null };
export function enrichmentSourceType(record: SourceRecord): EnrichmentSourceType {
  if (record.sourceType === "ai_model_knowledge" || record.sourceType === "open_library_description") return record.sourceType;
  // Older backups have no explicit source type. Infer from the saved input,
  // not from whether a work ID happened to be found.
  return record.olDescription?.trim() ? "open_library_description" : "ai_model_knowledge";
}
export function enrichmentSourceLabel(record: SourceRecord) {
  return enrichmentSourceType(record) === "ai_model_knowledge"
    ? "AI-generated — based on model knowledge; no matched Open Library description available."
    : "AI-generated — based on model knowledge and an Open Library description.";
}
