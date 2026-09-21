import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { authorize, OWNER } from "@/lib/auth";
import { backupTimestamp } from "@/lib/database-file";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await authorize(req, OWNER);
  if (denied) return denied;
  const directory = await mkdtemp(path.join(os.tmpdir(), "book-catalog-backup-"));
  const file = path.join(directory, "backup.db");
  try {
    const quoted = file.replace(/'/g, "''");
    await prisma.$executeRawUnsafe(`VACUUM INTO '${quoted}'`);
    const data = await readFile(file);
    return new Response(data, {
      headers: {
        "Content-Type": "application/vnd.sqlite3",
        "Content-Disposition": `attachment; filename="book-catalog-${backupTimestamp()}.db"`,
        "Content-Length": String(data.byteLength),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Database backup failed", error);
    return Response.json({ error: "Could not create the database backup." }, { status: 500 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
