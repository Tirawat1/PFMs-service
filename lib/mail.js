import nodemailer from "nodemailer";

// Sends an email if SMTP is configured AND the recipient user has
// emailNotify enabled with an address. Silently no-ops otherwise.
export async function sendMailToUser(user, subject, text) {
  if (!user || !user.emailNotify || !user.email) return;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (!SMTP_HOST) return;
  try {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT || 587),
      secure: Number(SMTP_PORT) === 465,
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    });
    await transporter.sendMail({
      from: SMTP_FROM || "WC Finance <noreply@example.com>",
      to: user.email,
      subject,
      text,
    });
  } catch (e) {
    console.error("Email send failed:", e.message);
  }
}
