import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorize, ensureOwner, normalizeEmail, ownerEmail, OWNER } from "@/lib/auth";

export async function GET(req: Request) {
  const denied = await authorize(req, OWNER); if (denied) return denied;
  await ensureOwner();
  const users = await prisma.user.findMany({ orderBy: { email: "asc" } });
  return NextResponse.json(users.map((u) => ({ ...u, role: u.email === ownerEmail() ? "OWNER" : u.role })));
}
export async function POST(req: Request) {
  const denied = await authorize(req, OWNER); if (denied) return denied;
  const body = await req.json().catch(() => null);
  const email = normalizeEmail(body?.email);
  if (!email || !["LIBRARIAN", "VIEW"].includes(body?.role) || typeof body?.active !== "boolean") return NextResponse.json({ error: "Enter a valid email and role." }, { status: 400 });
  if (email === ownerEmail()) return NextResponse.json({ error: "The Owner cannot be changed or disabled here." }, { status: 400 });
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.upsert({ where: { email }, create: { email, role: body.role, active: body.active }, update: { role: body.role, active: body.active } });
    if (!body.active) {
      await tx.session.deleteMany({ where: { userId: user.id } });
      await tx.loginCode.updateMany({ where: { email, consumed: false }, data: { consumed: true } });
    }
  });
  return NextResponse.json({ ok: true });
}
