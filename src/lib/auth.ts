import { createHash, createHmac } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

export const SESSION_COOKIE = "book_session";
export const SESSION_SECONDS = 30 * 24 * 60 * 60;
export const READ = ["OWNER", "LIBRARIAN", "VIEW"];
export const WRITE = ["OWNER", "LIBRARIAN"];
export const OWNER = ["OWNER"];
export function sameOrigin(req: Request) {
  try {
    const origin = new URL(req.headers.get("origin") || "");
    return ["https:", "http:"].includes(origin.protocol) && origin.host === req.headers.get("host");
  } catch { return false; }
}
export function normalizeEmail(value: unknown) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}
export function ownerEmail() { return normalizeEmail(process.env.OWNER_EMAIL); }
export function hashToken(token: string) { return createHash("sha256").update(token).digest("hex"); }
export function hashCode(email: string, code: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("Authentication is not configured.");
  return createHmac("sha256", secret).update(`${email}:${code}`).digest("hex");
}
export async function ensureOwner() {
  const email = ownerEmail();
  if (!email) throw new Error("Owner email is not configured.");
  // Ownership always comes from configuration, never from a user-editable role.
  return prisma.user.upsert({ where: { email }, create: { email, role: "VIEW" }, update: {} });
}
export async function currentUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!ownerEmail()) return null;
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!session || session.expiresAt <= new Date() || !session.user.active) return null;
  const role = session.user.email === ownerEmail() ? "OWNER" : session.user.role;
  if (!READ.includes(role) || (role === "OWNER" && session.user.email !== ownerEmail())) return null;
  return { id: session.user.id, email: session.user.email, role };
}
export async function requirePage(roles = READ) {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!roles.includes(user.role)) redirect("/");
  return user;
}
export async function authorize(req: Request, roles = READ) {
  if (!["GET", "HEAD"].includes(req.method)) {
    if (!sameOrigin(req)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  if (!roles.includes(user.role)) return NextResponse.json({ error: "You do not have permission for this action." }, { status: 403 });
  return null;
}
