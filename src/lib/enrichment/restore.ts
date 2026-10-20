import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";
import { sqliteFileUrl } from "../database-file";

export async function upgradeStagedBackup(file: string) {
  // Only the uploaded temporary copy is changed. Never push against the live DB here.
  await promisify(execFile)(process.execPath, [path.join(process.cwd(), "node_modules/prisma/build/index.js"), "db", "push", "--skip-generate", "--schema", path.join(process.cwd(), "prisma/schema.prisma")], {
    env: { ...process.env, DATABASE_URL: sqliteFileUrl(file) }, timeout: 60000, windowsHide: true,
  });
  const candidate = new PrismaClient({ datasources: { db: { url: sqliteFileUrl(file) } } });
  try {
    // Exercise generated full-row reads to catch missing columns as well as tables.
    await candidate.book.findMany({ take: 1 });
    await candidate.bookEnrichment.findMany({ take: 1, include: { revisions: { include: { concepts: true } } } });
    await candidate.enrichmentSettings.findMany({ take: 1 });
    await candidate.concept.findMany({ take: 1, include: { aliases: true } });
    await candidate.enrichmentJob.updateMany({ where: { status: { in: ["queued", "running"] } }, data: { status: "paused", message: "Restored from backup. Check API settings and usage, then resume manually." } });
    await candidate.enrichmentJobItem.updateMany({ where: { status: "running" }, data: { status: "queued", error: "Interrupted request restored; reservation retained." } });
    await candidate.enrichmentWorkerLease.deleteMany();
  } finally { await candidate.$disconnect(); }
}
