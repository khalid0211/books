const fs = require("node:fs");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");

function databasePath() {
  const url = process.env.DATABASE_URL || "";
  if (!url.startsWith("file:")) throw new Error("Production database protection currently requires SQLite.");
  let value = decodeURIComponent(url.slice(5).split("?")[0]);
  if (process.platform === "win32" && /^\/[A-Za-z]:\//.test(value)) value = value.slice(1);
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(process.cwd(), "prisma", value);
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

async function main() {
  const database = databasePath();
  const requireExisting = process.env.REQUIRE_EXISTING_DATABASE !== "false";
  if (!fs.existsSync(database) || fs.statSync(database).size === 0) {
    if (requireExisting) {
      throw new Error(`Refusing to start: the existing database was not found at ${database}. Check the persistent /data volume mount. No empty database was created.`);
    }
    console.log("No existing database found; initial database creation is explicitly allowed.");
    return;
  }

  const handle = fs.openSync(database, "r");
  const header = Buffer.alloc(16);
  try { fs.readSync(handle, header, 0, 16, 0); } finally { fs.closeSync(handle); }
  if (header.toString("binary") !== "SQLite format 3\u0000") throw new Error(`Refusing to start: ${database} is not a valid SQLite database.`);

  const directory = path.join(path.dirname(database), "deploy-backups");
  fs.mkdirSync(directory, { recursive: true });
  const backup = path.join(directory, `books-before-deploy-${timestamp()}.db`);
  const prisma = new PrismaClient();
  try {
    await prisma.$executeRawUnsafe(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
  } finally {
    await prisma.$disconnect();
  }
  console.log(`Pre-deployment database backup created: ${backup}`);

  const oldBackups = fs.readdirSync(directory)
    .filter((name) => /^books-before-deploy-.*\.db$/.test(name))
    .sort()
    .reverse()
    .slice(5);
  for (const name of oldBackups) fs.rmSync(path.join(directory, name), { force: true });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
