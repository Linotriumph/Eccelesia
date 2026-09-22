import { NextResponse } from "next/server";
import { hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resetPasswordSchema } from "@/lib/validation";
import { rateLimit } from "@/lib/rate-limit";
import { requireCsrf } from "@/lib/csrf";

export async function POST(request: Request) {
  const blocked = rateLimit(request, "reset");
  if (blocked) return blocked;
  const csrfBlocked = requireCsrf(request);
  if (csrfBlocked) return csrfBlocked;

  const body = await request.json().catch(() => null);
  const parsed = resetPasswordSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return NextResponse.json({ error: "No account found with that email." }, { status: 404 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { password: await hashPassword(password) },
  });
  await prisma.session.deleteMany({ where: { userId: user.id } });

  return NextResponse.json({ message: "Password updated successfully." });
}