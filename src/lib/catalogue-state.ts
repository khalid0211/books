export const EMPTY_CATALOGUE_FILTERS = { bookType: "", category: "", format: "", location: "", rating: "", author: "", language: "", owner: "", enrichment: "" };
export const ENRICHMENT_LABELS = { needs_review: "Needs attention", published: "Approved / published", insufficient: "Insufficient information", stale: "Book changed · regenerate", not_enriched: "Not enriched" };
export type EnrichmentStatus = keyof typeof ENRICHMENT_LABELS;
export type CatalogueState = { query: string; sort: string; direction: string; viewMode: "cards" | "table"; density: "compact" | "comfortable"; filters: typeof EMPTY_CATALOGUE_FILTERS; filtersOpen: boolean };
export function defaultCatalogueState(): CatalogueState {
  return { query: "", sort: "createdAt", direction: "desc", viewMode: "table", density: "comfortable", filters: { ...EMPTY_CATALOGUE_FILTERS }, filtersOpen: false };
}
const stateKeys = ["q", "sort", "dir", "view", "density", "filtersOpen", ...Object.keys(EMPTY_CATALOGUE_FILTERS)];
export function readCatalogueState(search: string, saved: string | null, owner: boolean): CatalogueState {
  const url = new URLSearchParams(search);
  const p = stateKeys.some(key => url.has(key)) ? url : new URLSearchParams(saved || "");
  const state = defaultCatalogueState();
  state.query = (p.get("q") || "").slice(0, 500);
  const sort = p.get("sort") || "";
  if (["createdAt", "id", "title", "authors", "publicationDate", "rating", "shelfLocation"].includes(sort)) state.sort = sort;
  if (p.get("dir") === "asc") state.direction = "asc";
  if (p.get("view") === "cards") state.viewMode = "cards";
  if (p.get("density") === "compact") state.density = "compact";
  for (const key of Object.keys(state.filters) as (keyof typeof state.filters)[]) state.filters[key] = (p.get(key) || "").slice(0, 500);
  if (!owner || !Object.hasOwn(ENRICHMENT_LABELS, state.filters.enrichment)) state.filters.enrichment = "";
  state.filtersOpen = p.get("filtersOpen") === "1" || Object.values(state.filters).some(Boolean);
  return state;
}
export function catalogueSearch(state: CatalogueState) {
  const p = new URLSearchParams();
  if (state.query) p.set("q", state.query);
  if (state.sort !== "createdAt") p.set("sort", state.sort);
  if (state.direction !== "desc") p.set("dir", state.direction);
  if (state.viewMode !== "table") p.set("view", state.viewMode);
  if (state.density !== "comfortable") p.set("density", state.density);
  if (state.filtersOpen) p.set("filtersOpen", "1");
  for (const [key, value] of Object.entries(state.filters)) if (value) p.set(key, value);
  return p.toString();
}
export function safeCatalogueReturn(value: unknown) {
  return typeof value === "string" && value.length <= 10000 && (value === "/" || value.startsWith("/?")) && !/[\r\n\\]/.test(value) ? value : "/";
}
