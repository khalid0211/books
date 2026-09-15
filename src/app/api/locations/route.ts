import { authorize, READ, WRITE, OWNER } from "@/lib/auth";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await authorize(req, READ); if (denied) return denied;
  try {
    return NextResponse.json(await prisma.room.findMany({
      orderBy: { code: "asc" },
      include: { cabinets: { orderBy: { number: "asc" }, include: { shelves: { orderBy: { number: "asc" } } } } },
    }));
  } catch {
    return NextResponse.json({ error: "Could not load locations." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const denied = await authorize(req, WRITE); if (denied) return denied;
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid location." }, { status: 400 });
  const invalid = (error: string) => NextResponse.json({ error }, { status: 400 });
  try {
    if (body.type === "room") {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
      if (!name || name.length > 80) return invalid("Enter a room name (up to 80 characters).");
      if (!/^[A-Z]{2,8}$/.test(code)) return invalid("Room code must contain 2–8 letters, for example ST.");
      return NextResponse.json(await prisma.room.create({ data: { name, code } }), { status: 201 });
    }
    if (body.type !== "cabinet" && body.type !== "shelf") return invalid("Choose room, cabinet, or shelf.");
    const number = Number(body.number);
    const parentId = Number(body.parentId);
    if (!Number.isInteger(number) || number < 1 || number > 999) return invalid("Number must be between 1 and 999.");
    if (!Number.isSafeInteger(parentId) || parentId < 1) return invalid("Select a parent location.");
    const entry = body.type === "cabinet"
      ? await prisma.cabinet.create({ data: { number, roomId: parentId } })
      : await prisma.shelf.create({ data: { number, cabinetId: parentId } });
    return NextResponse.json(entry, { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2002") return NextResponse.json({ error: "That code or number already exists in this location." }, { status: 409 });
      if (err.code === "P2003") return invalid("Parent location no longer exists. Reload and try again.");
    }
    return NextResponse.json({ error: "Could not save location." }, { status: 500 });
  }
}
