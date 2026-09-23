import { requirePage, WRITE, ownerEmail } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { flattenLocations } from "@/lib/locations";
import Loans from "@/components/Loans";

export default async function LoansPage() {
  await requirePage(WRITE);
  const [borrowers, rooms] = await Promise.all([
    prisma.user.findMany({ where: { active: true, role: { in: ["VIEW", "LIBRARIAN"] }, email: { not: ownerEmail() } }, select: { id: true, email: true }, orderBy: { email: "asc" } }),
    prisma.room.findMany({ include: { cabinets: { include: { shelves: true } } }, orderBy: { code: "asc" } }),
  ]);
  return <Loans borrowers={borrowers} locations={flattenLocations(rooms)} />;
}
