import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authorize, READ, WRITE } from "@/lib/auth";

export async function GET(req: Request) {
  const denied = await authorize(req, READ); if (denied) return denied;
  return NextResponse.json(await prisma.bookOwner.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, _count: { select: { books: true } } } }));
}

async function save(req: Request, update: boolean) {
  const denied = await authorize(req, WRITE); if (denied) return denied;
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.normalize("NFKC").trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > 80) return NextResponse.json({ error: "Enter a name up to 80 characters." }, { status: 400 });
  if (update && (!Number.isSafeInteger(body.id) || body.id < 1)) return NextResponse.json({ error: "Select a valid owner." }, { status: 400 });
  const data = { name, nameKey: name.toLowerCase() };
  try {
    const owner = update ? await prisma.bookOwner.update({ where: { id: body.id }, data }) : await prisma.bookOwner.create({ data });
    return NextResponse.json(owner, { status: update ? 200 : 201 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2002") return NextResponse.json({ error: "That book owner already exists." }, { status: 409 });
      if (e.code === "P2025") return NextResponse.json({ error: "Book owner no longer exists." }, { status: 404 });
    }
    return NextResponse.json({ error: "Could not save book owner." }, { status: 500 });
  }
}
export function POST(req: Request) { return save(req, false); }
export function PUT(req: Request) { return save(req, true); }
