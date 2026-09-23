export const DEFAULT_LOAN_DAYS = 15;
export function loanDates(borrowedAt: unknown, days: unknown, now = new Date()) {
  if (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > 3650) throw new Error("Borrow time must be between 1 and 3650 whole days.");
  const start = borrowedAt === undefined ? now : typeof borrowedAt === "string" ? new Date(borrowedAt) : new Date(NaN);
  if (!Number.isFinite(start.getTime()) || start.getTime() > now.getTime() + 60000 || start.getFullYear() < 1900) throw new Error("Enter a valid borrowing date/time that is not in the future.");
  return { borrowedAt: start, dueAt: new Date(start.getTime() + days * 86400000) };
}
