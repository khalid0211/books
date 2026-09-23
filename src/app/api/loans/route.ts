import { Prisma } from "@prisma/client";
import { authorize, WRITE, ownerEmail } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseBookId } from "@/lib/book-id";
import { DEFAULT_LOAN_DAYS, loanDates } from "@/lib/loans";
import { flattenLocations } from "@/lib/locations";
import { sendLoanReminder } from "@/lib/email";

export const dynamic = "force-dynamic";
const include = { book: { select: { id: true, title: true, shelfLocation: true } }, borrower: { select: { email: true } } };
const fail = (error: string, status = 400) => Response.json({ error }, { status });

export async function GET(req: Request) {
  const denied = await authorize(req, WRITE); if (denied) return denied;
  const history = new URL(req.url).searchParams.get("history") === "true";
  const loans = await prisma.loan.findMany({ where: history ? { returnedAt: { not: null } } : { returnedAt: null }, include, orderBy: history ? { returnedAt: "desc" } : { dueAt: "asc" }, ...(history ? { take: 200 } : {}) });
  return Response.json(loans);
}

export async function POST(req: Request) {
  const denied = await authorize(req, WRITE); if (denied) return denied;
  const body = await req.json().catch(() => null);
  if (!body || !["borrow", "return", "remind"].includes(body.action)) return fail("Choose borrow, return, or remind.");
  try {
    if (body.action === "remind") {
      if (!Number.isSafeInteger(body.loanId) || body.loanId <= 0) return fail("Invalid loan.");
      const now = new Date();
      // Claim a short delivery window to prevent duplicate clicks or concurrent sends.
      const claim = await prisma.loan.updateMany({ where: { id: body.loanId, returnedAt: null, dueAt: { lt: now }, OR: [{ reminderAttemptAt: null }, { reminderAttemptAt: { lt: new Date(now.getTime() - 60000) } }] }, data: { reminderAttemptAt: now } });
      if (!claim.count) return fail("Only overdue, unreturned books can be reminded. Wait one minute between reminders.", 409);
      const loan = await prisma.loan.findUniqueOrThrow({ where: { id: body.loanId }, include });
      if (loan.returnedAt) return fail("This book has already been returned.", 409);
      try { await sendLoanReminder(loan.borrower.email, loan.book.title, loan.bookId, loan.dueAt); }
      catch { return fail("Email could not be sent or confirmed. Check email settings and wait a minute before retrying.", 502); }
      await prisma.loan.update({ where: { id: loan.id }, data: { reminderSentAt: new Date() } });
      return Response.json({ message: `Reminder sent to ${loan.borrower.email}.` });
    }
    const bookId = parseBookId(body.bookId);
    if (!bookId) return fail("Enter a library book ID such as B000123 or 123.");
    if (body.action === "return") {
      return await prisma.$transaction(async (tx) => {
        const loan = await tx.loan.findUnique({ where: { activeBookId: bookId }, include });
        if (!loan) return fail("No active loan exists for this book.", 404);
        const shelf = body.shelfLocation || loan.book.shelfLocation;
        const rooms = await tx.room.findMany({ include: { cabinets: { include: { shelves: true } } } });
        if (!flattenLocations(rooms).some((location) => location.code === shelf)) return fail("Choose an existing shelf for the returned book.");
        await tx.book.update({ where: { id: bookId }, data: { shelfLocation: shelf } });
        await tx.loan.update({ where: { id: loan.id }, data: { returnedAt: new Date(), activeBookId: null } });
        return Response.json({ message: `Returned ${loan.book.title}. Put it on shelf ${shelf}.` });
      });
    }
    let dates;
    try { dates = loanDates(body.borrowedAt, body.days ?? DEFAULT_LOAN_DAYS); }
    catch (error) { return fail((error as Error).message); }
    if (!Number.isSafeInteger(body.borrowerId) || body.borrowerId <= 0) return fail("Select an active borrower.");
    return await prisma.$transaction(async (tx) => {
      const borrower = await tx.user.findFirst({ where: { id: body.borrowerId, active: true, role: { in: ["VIEW", "LIBRARIAN"] }, email: { not: ownerEmail() } } });
      if (!borrower) return fail("Select an active View or Librarian account.");
      if (!await tx.book.findUnique({ where: { id: bookId } })) return fail("No book has that ID.", 404);
      const loan = await tx.loan.create({ data: { bookId, activeBookId: bookId, borrowerId: borrower.id, ...dates }, include });
      return Response.json(loan, { status: 201 });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return fail("This copy is already borrowed. Return it before lending it again.", 409);
    return fail("Could not complete the action. Refresh the borrowed books list before retrying.", 500);
  }
}
