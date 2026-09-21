import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, open, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { authorize, OWNER } from "@/lib/auth";
import { backupTimestamp, databaseFilePath, databaseRestoreRunning, setDatabaseRestoreRunning, sqliteFileUrl } from "@/lib/database-file";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BACKUP_BYTES = 256 * 1024 * 1024;
const REQUIRED_TABLES = ["Book", "BookOwner", "Cabinet", "Category", "LoginCode", "Room", "Session", "Shelf", "User", "_BookToCategory"];

async function validateBackup(file: string) {
  const handle = await open(file, "r");
  const header = Buffer.alloc(16);
  try { await handle.read(header, 0, 16, 0); } finally { await handle.close(); }
  if (header.toString("binary") !== "SQLite format 3\u0000") throw new Error("The selected file is not a SQLite database.");

  const candidate = new PrismaClient({ datasources: { db: { url: sqliteFileUrl(file) } } });
  try {
    const integrity = await candidate.$queryRawUnsafe<Record<string, string>[]>("PRAGMA integrity_check");
    if (!integrity.some((row) => Object.values(row).includes("ok"))) throw new Error("The database integrity check failed.");
    const tables = await candidate.$queryRawUnsafe<{ name: string }[]>("SELECT name FROM sqlite_master WHERE type = 'table'");
    const names = new Set(tables.map((table) => table.name));
    const missing = REQUIRED_TABLES.filter((name) => !names.has(name));
    if (missing.length) throw new Error(`The backup is missing required tables: ${missing.join(", ")}.`);
    await candidate.$queryRawUnsafe("SELECT id, title FROM Book LIMIT 1");
  } finally {
    await candidate.$disconnect();
  }
}

export async function POST(req: Request) {
  const denied = await authorize(req, OWNER);
  if (denied) return denied;
  if (databaseRestoreRunning()) return Response.json({ error: "Another restore is already running." }, { status: 409 });
  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > MAX_BACKUP_BYTES + 1024 * 1024) return Response.json({ error: "The backup file is too large (maximum 256 MB)." }, { status: 413 });

  setDatabaseRestoreRunning(true);
  let uploadDirectory = "";
  let upload = "";
  let staged = "";
  let previous = "";
  try {
    uploadDirectory = await mkdtemp(path.join(os.tmpdir(), "book-catalog-restore-"));
    upload = path.join(uploadDirectory, "uploaded.db");
    const form = await req.formData();
    if (form.get("confirmation") !== "RESTORE") return Response.json({ error: "Type RESTORE to confirm." }, { status: 400 });
    const value = form.get("backup");
    if (!(value instanceof File) || !value.name.toLowerCase().endsWith(".db")) return Response.json({ error: "Choose a .db backup file." }, { status: 400 });
    if (!value.size || value.size > MAX_BACKUP_BYTES) return Response.json({ error: "The backup must be between 1 byte and 256 MB." }, { status: 413 });
    await writeFile(upload, Buffer.from(await value.arrayBuffer()), { flag: "wx" });
    await validateBackup(upload);

    const database = databaseFilePath();
    await mkdir(path.dirname(database), { recursive: true });
    await stat(database);
    staged = path.join(path.dirname(database), `.${path.basename(database)}.restore-${randomUUID()}`);
    previous = path.join(path.dirname(database), `${path.basename(database)}.before-restore-${backupTimestamp()}-${randomUUID().slice(0, 8)}.bak`);
    await copyFile(upload, staged);
    try { await prisma.$executeRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE)"); } catch { /* Database may not use WAL mode. */ }
    await prisma.$disconnect();
    await rename(database, previous);
    try {
      await rename(staged, database);
      await Promise.all([rm(`${database}-wal`, { force: true }), rm(`${database}-shm`, { force: true }), rm(`${database}-journal`, { force: true })]);
      await prisma.$connect();
      await prisma.book.count();
    } catch (error) {
      await rm(database, { force: true });
      await rename(previous, database);
      await prisma.$connect();
      throw error;
    }
    return Response.json({ message: "Database restored successfully. Sign in again if your session came from the replaced database.", safetyBackup: path.basename(previous) });
  } catch (error) {
    console.error("Database restore failed", error);
    const message = error instanceof Error && /SQLite|integrity|required tables|not a SQLite/.test(error.message) ? error.message : "Could not restore the database. The existing database was kept.";
    return Response.json({ error: message }, { status: 400 });
  } finally {
    setDatabaseRestoreRunning(false);
    if (staged) await rm(staged, { force: true });
    if (uploadDirectory) await rm(uploadDirectory, { recursive: true, force: true });
  }
}
