export type CataloguePosition = { query: string; windowY: number; tableTop: number; tableLeft: number };
export function readCataloguePosition(raw: string | null, query: string): CataloguePosition | null {
  try {
    const value = JSON.parse(raw || "null");
    return value && value.query === query && [value.windowY, value.tableTop, value.tableLeft].every(n => typeof n === "number" && Number.isFinite(n) && n >= 0) ? value : null;
  } catch { return null; }
}
