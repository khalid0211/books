import { randomBytes, randomInt } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureOwner, hashCode, hashToken, normalizeEmail, ownerEmail, sameOrigin, SESSION_COOKIE, SESSION_SECONDS } from "@/lib/auth";
import { sendLoginCode } from "@/lib/email";

export async function POST(req: Request, ctx: { params: Promise<{ action: string }> }) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const { action } = await ctx.params;
  const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });
  try {
    if (action === "logout") {
      const { cookies } = await import("next/headers");
      const token = (await cookies()).get(SESSION_COOKIE)?.value;
      if (token) await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
      const res = NextResponse.json({ ok: true });
      res.cookies.set(SESSION_COOKIE, "", { maxAge: 0, path: "/" });
      return res;
    }
    if (action !== "request-code" && action !== "verify") return fail("Not found.", 404);
    if (!ownerEmail() || !process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32) return fail("Login is not configured. Set OWNER_EMAIL and AUTH_SECRET on the server.", 503);
    const body = await req.json().catch(() => null);
    const email = normalizeEmail(body?.email);
    if (!email) return fail("Enter a valid email address.");
    await ensureOwner();
    const user = await prisma.user.findUnique({ where: { email } });
    if (action === "request-code") {
      const generic = () => NextResponse.json({ ok: true, message: "If your email has access, a code has been sent." });
      if (!user?.active) return generic();
      const code = String(randomInt(0, 1000000)).padStart(6, "0");
      const now = new Date();
      const created = await prisma.$transaction(async (tx) => {
        const recent = await tx.loginCode.findMany({ where: { email, createdAt: { gt: new Date(Date.now() - 3600000) } }, orderBy: { createdAt: "desc" } });
        if (recent.length >= 5 || (recent[0] && now.getTime() - recent[0].createdAt.getTime() < 60000)) return null;
        await tx.loginCode.updateMany({ where: { email, consumed: false }, data: { consumed: true } });
        return tx.loginCode.create({ data: { email, hash: hashCode(email, code), expiresAt: new Date(Date.now() + 600000) } });
      });
      if (!created) return fail("Please wait before requesting another code (maximum 5 per hour).", 429);
      try { await sendLoginCode(email, code); } catch {
        await prisma.loginCode.update({ where: { id: created.id }, data: { consumed: true } });
        return fail("Could not send email. Check the server email configuration and try again later.", 502);
      }
      return generic();
    }
    if (!/^\d{6}$/.test(body?.code || "")) return fail("Enter the six-digit code.");
    if (!user?.active) return fail("Invalid or expired code.");
    const token = randomBytes(32).toString("hex");
    const valid = await prisma.$transaction(async (tx) => {
      const row = await tx.loginCode.findFirst({ where: { email, consumed: false }, orderBy: { id: "desc" } });
      if (!row || row.expiresAt <= new Date() || row.attempts >= 5) return false;
      const claimed = await tx.loginCode.updateMany({ where: { id: row.id, consumed: false, attempts: { lt: 5 }, expiresAt: { gt: new Date() } }, data: { attempts: { increment: 1 } } });
      if (!claimed.count || row.hash !== hashCode(email, body.code)) return false;
      await tx.loginCode.update({ where: { id: row.id }, data: { consumed: true } });
      await tx.session.create({ data: { tokenHash: hashToken(token), userId: user.id, expiresAt: new Date(Date.now() + SESSION_SECONDS * 1000) } });
      return true;
    });
    if (!valid) return fail("Invalid or expired code. Request a new code after five unsuccessful attempts.");
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, secure: new URL(req.headers.get("origin")!).protocol === "https:", sameSite: "lax", path: "/", maxAge: SESSION_SECONDS });
    return res;
  } catch { return fail("Login could not be completed. Please try again.", 500); }
}
