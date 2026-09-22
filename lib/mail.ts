import nodemailer from "nodemailer";
import { randomBytes } from "node:crypto";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT ?? 587),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export const APP_URL =
  process.env.APP_URL ?? (process.env.NODE_ENV === "production" ? "" : "http://localhost:3000");

/** Cryptographically secure single-use token (no Math.random). */
export function generateSecureToken(): string {
  return randomBytes(32).toString("hex");
}

interface MailOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

export async function sendMail({ to, subject, text, html }: MailOptions) {
  return transporter.sendMail({
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
    to,
    subject,
    text,
    html,
  });
}

/** Emails the plain-text verification CODE for entry in the verify form. */
export async function sendVerificationCodeEmail(to: string, code: string) {
  return sendMail({
    to,
    subject: "Your email verification code",
    text: `Your email verification code is: ${code}. It expires in 15 minutes. If you didn't create an account, you can ignore this email.`,
    html: `<p>Your email verification code is:</p><p style="font-size:26px;font-weight:700;letter-spacing:6px;">${code}</p><p>Enter this code in the verify form on your dashboard within 15 minutes.</p>`,
  });
}

export async function sendPasswordResetEmail(to: string, token: string) {
  const resetUrl = `${APP_URL}/reset-password?token=${token}`;
  return sendMail({
    to,
    subject: "Reset your password",
    text: `Reset your password here: ${resetUrl}`,
    html: `<p>Click <a href="${resetUrl}">here</a> to reset your password.</p>`,
  });
}
