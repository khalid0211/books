/** Accept the printed collection number or a manually entered numeric ID. */
export function parseBookId(value: unknown): number | null {
  if (typeof value !== "string" || !/^(?:B)?\d{1,10}$/i.test(value.trim())) return null;
  const id = Number(value.trim().replace(/^B/i, ""));
  return Number.isSafeInteger(id) && id > 0 && id <= 2147483647 ? id : null;
}
