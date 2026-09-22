import { NextResponse } from "next/server";
import { getOrCreateSession, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loginSchema } from "@/lib/validation";
import { rateLimit } from "@/lib/rate-limit";
import { requireCsrf } from "@/lib/csrf";

export async function POST(request: Request) {
  const blocked = rateLimit(request, "login");
  if (blocked) return blocked;
  const csrfBlocked = requireCsrf(request);
  if (csrfBlocked) return csrfBlocked;

  const body = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(password, user.password))) {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  await getOrCreateSession(user.id);

  return NextResponse.json({
    user: {
      id: user.id,
      firstName: user.firstName,
      middleName: user.middleName,
      lastName: user.lastName,
      email: user.email,
    },
  });
}