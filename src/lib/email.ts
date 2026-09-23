import nodemailer from "nodemailer";

async function sendEmail(email: string, subject: string, text: string) {
  const { SMTP_HOST, SMTP_USER, SMTP_PASS, MAIL_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !MAIL_FROM) throw new Error("Email delivery is not configured.");
  const port = Number(process.env.SMTP_PORT || 587);
  const transport = nodemailer.createTransport({
    host: SMTP_HOST, port, secure: port === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
  });
  await transport.sendMail({ from: MAIL_FROM, to: email, subject, text });
}

export async function sendLoginCode(email: string, code: string) {
  await sendEmail(email, "Your Book Catalog login code", `Your Book Catalog login code is ${code}. It expires in 10 minutes. If you did not request this, ignore this email.`);
}

export async function sendLoanReminder(email: string, title: string, id: number, dueAt: Date) {
  await sendEmail(email, "Library book return reminder", `Please return "${title}" (B${String(id).padStart(6, "0")}). Its return date was ${dueAt.toUTCString()}. Please contact the librarian to arrange its return. Thank you.`);
}
