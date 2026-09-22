import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getPlanBySlug } from "@/lib/plans";
import { createCheckoutSession, verifyTransactionByRef, type FlwTransaction } from "@/lib/flutterwave";
import { hasActiveAccess, activateSubscriptionFromTransaction } from "@/lib/subscriptions";
import { requireCsrf } from "@/lib/csrf";
import { rateLimit } from "@/lib/rate-limit";

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const PENDING_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-NG", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export async function POST(request: Request) {
  const blocked = rateLimit(request, "checkout");
  if (blocked) return blocked;
  const csrfBlocked = requireCsrf(request);
  if (csrfBlocked) return csrfBlocked;

  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "You need to be signed in." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const planSlug = body?.planSlug as string | undefined;
  const confirmed = body?.confirmed === true;
  if (!planSlug || (planSlug !== "monthly" && planSlug !== "yearly")) {
    return NextResponse.json({ error: "Invalid plan." }, { status: 400 });
  }

  const plan = getPlanBySlug(planSlug);
  if (!plan || !plan.flwPlanId) {
    return NextResponse.json(
      { error: "This plan is not available yet. Please try again later." },
      { status: 500 },
    );
  }

  const existing = await prisma.subscription.findUnique({
    where: { userId: user.id },
  });

  // Double-charge guard #1: a still-active (non-cancelled) subscription on this
  // exact plan must not be stacked with another billing for the same plan.
  if (
    existing &&
    existing.planSlug === planSlug &&
    hasActiveAccess(existing) &&
    existing.status !== "canceled"
  ) {
    const renews = existing.currentPeriodEnd?.toLocaleDateString("en-NG", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    return NextResponse.json(
      {
        error: `You are already on the ${plan.name} plan${
          renews ? ` (your access renews on ${renews})` : ""
        }. Starting another subscription would double-charge you.`,
      },
      { status: 400 },
    );
  }

  // Double-charge guard #2: clear stale in-flight checkouts first, then handle
  // any checkout still in progress. A payment that actually completed on
  // Flutterwave but was never confirmed (webhook/return-page hiccup) is applied
  // to the account instead of blocking. A genuinely abandoned one can be reset
  // by the user via DELETE /api/checkout.
  await prisma.paymentLog.updateMany({
    where: {
      userId: user.id,
      source: "checkout",
      status: "pending",
      createdAt: { lt: new Date(Date.now() - PENDING_WINDOW_MS) },
    },
    data: { status: "abandoned" },
  });

  const pendingCheckout = await prisma.paymentLog.findFirst({
    where: {
      userId: user.id,
      source: "checkout",
      status: "pending",
      createdAt: { gte: new Date(Date.now() - PENDING_WINDOW_MS) },
    },
  });
  if (pendingCheckout) {
    let verified: FlwTransaction | null = null;
    try {
      verified = await verifyTransactionByRef(pendingCheckout.txRef);
    } catch {
      verified = null;
    }
    const paid =
      verified?.status === "successful" &&
      verified.currency === pendingCheckout.currency &&
      verified.amount === pendingCheckout.amount;

    if (paid) {
      const activated = await activateSubscriptionFromTransaction(
        pendingCheckout.txRef,
        verified?.id,
        user.id,
      ).catch(() => false);
      if (activated) {
        return NextResponse.json(
          {
            code: "PREVIOUS_PAYMENT_COMPLETED",
            error:
              "Your earlier payment for the " +
              (pendingCheckout.planSlug
                ? capitalize(pendingCheckout.planSlug)
                : "selected") +
              " plan was completed and applied to your account. Go to billing to review.",
          },
          { status: 409 },
        );
      }
    }

    return NextResponse.json(
      {
        code: "PAYMENT_IN_PROGRESS",
        error:
          "You already have a payment in progress. Complete that payment, or cancel it to start a new checkout.",
      },
      { status: 409 },
    );
  }

  // Plan-conflict guard: the user cancelled their plan but still has paid
  // access running until currentPeriodEnd. Buying any plan now would overlap
  // that pre-paid time, so refuse to open checkout until they approve adding
  // the new plan AFTER the running plan is exhausted. That approval is what
  // re-shows the running plan and the CTA to queue the purchase.
  if (
    existing &&
    hasActiveAccess(existing) &&
    existing.status === "canceled" &&
    existing.currentPeriodEnd &&
    !confirmed
  ) {
    const samePlan = existing.planSlug === planSlug;
    const accessUntil = existing.currentPeriodEnd;
    const endsOn = formatDate(accessUntil);
    return NextResponse.json(
      {
        code: "PLAN_QUEUE_CONFIRMATION_REQUIRED",
        error: samePlan
          ? `Your ${existing.planSlug} plan is cancelled but still running until ${endsOn}. Resubscribing adds a new period after that date so you're never double-billed.`
          : `Your ${existing.planSlug} plan is cancelled but still running until ${endsOn}. The ${planSlug} plan you're buying will start after that date and no paid time is lost.`,
        running: {
          planSlug: existing.planSlug,
          name: capitalize(existing.planSlug),
          accessUntil: accessUntil.toISOString(),
        },
        target: { planSlug: plan.slug, name: plan.name },
        startsAfter: accessUntil.toISOString(),
      },
      { status: 409 },
    );
  }

  const txRef = `ECC-${user.id.slice(0, 12)}-${Date.now()}`;
  const log = await prisma.paymentLog.create({
    data: {
      userId: user.id,
      planSlug,
      amount: plan.amount,
      txRef,
      currency: "NGN",
      status: "pending",
      source: "checkout",
    },
  });

  try {
    const result = await createCheckoutSession({
      tx_ref: txRef,
      amount: plan.amount,
      currency: "NGN",
      redirect_url: `${APP_URL}/dashboard/checkout/return`,
      customer: {
        email: user.email,
        name: [user.firstName, user.middleName, user.lastName].filter(Boolean).join(" "),
      },
      payment_plan: plan.flwPlanId,
      customizations: {
        title: "Eccelesia — " + plan.name,
      },
    });

    return NextResponse.json({ url: result.link });
  } catch (err) {
    await prisma.paymentLog.delete({ where: { id: log.id } }).catch(() => {});
    const message =
      err instanceof Error ? err.message : "Failed to initiate checkout.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

/**
 * Abandons the user's in-flight checkout(s) so they can start a fresh one.
 * Only pending (unpaid, unconfirmed) logs are affected — a completed payment
 * that was verified is never discarded here.
 */
export async function DELETE(request: Request) {
  const blocked = rateLimit(request, "checkout");
  if (blocked) return blocked;
  const csrfBlocked = requireCsrf(request);
  if (csrfBlocked) return csrfBlocked;

  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "You need to be signed in." }, { status: 401 });
  }

  const result = await prisma.paymentLog.updateMany({
    where: {
      userId: user.id,
      source: "checkout",
      status: "pending",
    },
    data: { status: "abandoned" },
  });

  return NextResponse.json({ ok: true, voided: result.count });
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}