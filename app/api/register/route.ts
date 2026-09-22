import { NextResponse } from "next/server";
import { createSession, hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { registerSchema } from "@/lib/validation";
import { sendVerificationCodeEmail } from "@/lib/mail";
import { createEmailVerification } from "@/lib/verification";
import { requireCsrf } from "@/lib/csrf";

export async function POST(request: Request) {
  const csrfBlocked = requireCsrf(request);
  if (csrfBlocked) return csrfBlocked;

  const body = await request.json().catch(() => null);
  const parsed = registerSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { name, email, password } = parsed.data;
  const words = name.split(/\s+/).filter(Boolean);
  const firstName = words[0];
  const lastName = words[words.length - 1];
  const middleName = words.length > 2 ? words.slice(1, -1).join(" ") : null;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "An account with that email already exists." }, { status: 409 });
  }

  const user = await prisma.user.create({
    data: { firstName, middleName, lastName, email, password: await hashPassword(password) },
    select: { id: true, firstName: true, middleName: true, lastName: true, email: true, emailVerified: true },
  });

  await createSession(user.id);

  // Generate and store a verification code, then email it in the background.
  // Registration must succeed even if the email transport is unavailable.
  const code = await createEmailVerification(user.id);
  sendVerificationCodeEmail(user.email, code).catch(() => {}).catch(() => {
    // Best effort: if delivery fails the dashboard can resend the code.
  });

  return NextResponse.json({ user }, { status: 201 });
}