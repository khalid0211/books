import { requirePage, WRITE } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { flattenLocations } from "@/lib/locations";
import MoveBooks from "@/components/MoveBooks";

export default async function MoveBooksPage() {
  await requirePage(WRITE);
  const rooms = await prisma.room.findMany({ orderBy: { code: "asc" }, include: { cabinets: { orderBy: { number: "asc" }, include: { shelves: { orderBy: { number: "asc" } } } } } });
  return <MoveBooks locations={flattenLocations(rooms)} />;
}
