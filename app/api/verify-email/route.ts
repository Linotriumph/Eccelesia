import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { sendVerificationCodeEmail } from "@/lib/mail";
import { createEmailVerification, verifyEmailCode } from "@/lib/verification";
import { rateLimit } from "@/lib/rate-limit";
import { requireCsrf } from "@/lib/csrf";

/** Verifies a submitted code, or (with `resend`) issues and re-emails a new one. */
export async function POST(request: Request) {
  const blocked = rateLimit(request, "verify");
  if (blocked) return blocked;
  const csrfBlocked = requireCsrf(request);
  if (csrfBlocked) return csrfBlocked;

  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "You need to be signed in to verify your email." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const { code, resend } = body ?? {};

  if (resend || (typeof code === "string" && code === "")) {
    const fresh = await createEmailVerification(user.id);
    sendVerificationCodeEmail(user.email, fresh).catch(() => {});
    return NextResponse.json({ resent: true });
  }

  if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "Your verification code must be 6 digits." }, { status: 400 });
  }

  const error = await verifyEmailCode(user.id, code);
  if (error) {
    if (error.includes("expired")) {
      const fresh = await createEmailVerification(user.id);
      sendVerificationCodeEmail(user.email, fresh).catch(() => {});
    }
    return NextResponse.json({ error }, { status: 400 });
  }

  return NextResponse.json({ emailVerified: true });
}
