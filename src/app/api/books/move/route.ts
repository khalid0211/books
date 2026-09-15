import { NextResponse } from "next/server";
import { authorize, WRITE } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseBookId } from "@/lib/book-id";
import { flattenLocations } from "@/lib/locations";

export async function POST(req: Request) {
  const denied = await authorize(req, WRITE); if (denied) return denied;
  const body = await req.json().catch(() => null);
  const id = parseBookId(body?.bookId);
  if (!id) return NextResponse.json({ error: "Enter a book ID such as B000123 or 123." }, { status: 400 });
  try {
    return await prisma.$transaction(async (tx) => {
      const rooms = await tx.room.findMany({ include: { cabinets: { include: { shelves: true } } } });
      if (!flattenLocations(rooms).some((location) => location.code === body?.shelfLocation)) {
        return NextResponse.json({ error: "Select an existing shelf location." }, { status: 400 });
      }
      const existing = await tx.book.findUnique({ where: { id } });
      if (!existing) return NextResponse.json({ error: "No book has that ID. Check the label and try again." }, { status: 404 });
      const unchanged = existing.shelfLocation === body.shelfLocation;
      const book = unchanged ? existing : await tx.book.update({ where: { id }, data: { shelfLocation: body.shelfLocation } });
      return NextResponse.json({ id: book.id, title: book.title, shelfLocation: book.shelfLocation, previousLocation: existing.shelfLocation, unchanged });
    });
  } catch {
    return NextResponse.json({ error: "Could not move the book. Check its location before retrying." }, { status: 500 });
  }
}
