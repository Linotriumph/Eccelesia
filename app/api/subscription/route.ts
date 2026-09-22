import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cancelUserSubscription } from "@/lib/subscriptions";
import { requireCsrf } from "@/lib/csrf";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const subscription = await prisma.subscription.findUnique({
    where: { userId: user.id },
    select: {
      id: true,
      planSlug: true,
      amount: true,
      currency: true,
      status: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
      canceledAt: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ subscription });
}

export async function DELETE(request: Request) {
  const csrfBlocked = requireCsrf(request);
  if (csrfBlocked) return csrfBlocked;

  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const cancelReason =
    typeof body?.cancelReason === "string" && body.cancelReason.trim()
      ? body.cancelReason.trim()
      : undefined;

  const result = await cancelUserSubscription(user.id, cancelReason);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    currentPeriodEnd: result.currentPeriodEnd,
  });
}