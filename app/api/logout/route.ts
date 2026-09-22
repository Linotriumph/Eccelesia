import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCsrf } from "@/lib/csrf";

export async function POST(request: Request) {
  const csrfBlocked = requireCsrf(request);
  if (csrfBlocked) return csrfBlocked;

  const cookieStore = await cookies();
  const token = cookieStore.get("session")?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { token } });
    cookieStore.delete("session");
  }
  return NextResponse.json({ ok: true });
}