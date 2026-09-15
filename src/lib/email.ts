import nodemailer from "nodemailer";

export async function sendLoginCode(email: string, code: string) {
  const { SMTP_HOST, SMTP_USER, SMTP_PASS, MAIL_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !MAIL_FROM) throw new Error("Email delivery is not configured.");
  const port = Number(process.env.SMTP_PORT || 587);
  const transport = nodemailer.createTransport({
    host: SMTP_HOST, port, secure: port === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
  });
  await transport.sendMail({ from: MAIL_FROM, to: email, subject: "Your Book Catalog login code",
    text: `Your Book Catalog login code is ${code}. It expires in 10 minutes. If you did not request this, ignore this email.` });
}
