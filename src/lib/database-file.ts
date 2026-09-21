import path from "node:path";

const maintenance = globalThis as unknown as { bookDatabaseRestoreRunning?: boolean };

/** Resolve the SQLite file used by Prisma. Relative file URLs are relative to prisma/schema.prisma. */
export function databaseFilePath() {
  const url = process.env.DATABASE_URL || "file:./dev.db";
  if (!url.startsWith("file:")) throw new Error("Database backup is available only when the app uses SQLite.");
  let value = decodeURIComponent(url.slice(5).split("?")[0]);
  if (process.platform === "win32" && /^\/[A-Za-z]:\//.test(value)) value = value.slice(1);
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(process.cwd(), "prisma", value);
}

export function sqliteFileUrl(file: string) {
  return `file:${file.replace(/\\/g, "/")}`;
}

export function backupTimestamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function databaseRestoreRunning() { return Boolean(maintenance.bookDatabaseRestoreRunning); }
export function setDatabaseRestoreRunning(value: boolean) { maintenance.bookDatabaseRestoreRunning = value; }
