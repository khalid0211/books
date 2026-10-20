import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

// Instrumentation and route bundles must share one client, including production:
// restore disconnects this client before replacing the SQLite file.
globalForPrisma.prisma = prisma;
