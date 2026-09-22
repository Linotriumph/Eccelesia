import { prisma } from "./prisma";
import { getPlanBySlug } from "./plans";
import {
  cancelSubscription,
  fetchAllSubscriptions,
  verifyTransaction,
  verifyTransactionByRef,
  type FlwTransaction,
} from "./flutterwave";

function addInterval(date: Date, interval: "monthly" | "yearly"): Date {
  const next = new Date(date);
  if (interval === "monthly") {
    next.setUTCMonth(next.getUTCMonth() + 1);
  } else {
    next.setUTCFullYear(next.getUTCFullYear() + 1);
  }
  return next;
}

/** Whether the user should currently have paid access. */
export function hasActiveAccess(subscription: {
  status: string;
  currentPeriodEnd: Date | null;
}): boolean {
  if (!subscription.currentPeriodEnd) return false;
  return (
    subscription.status === "active" ||
    (subscription.status === "canceled" && subscription.currentPeriodEnd > new Date())
  );
}

async function resolveFlwSubscriptionId(email: string, planId: number): Promise<number | null> {
  try {
    // Prefer an email+plan match (production data is keyed by real customer
    // email). Flutterwave sometimes rewrites the customer email on sandbox
    // checkouts (e.g. ravesb_<hash>_<original>@gmail.com) and an email filter
    // then returns nothing, so fall back to the first active plan match.
    const byEmailAndPlan = await fetchAllSubscriptions({ email, status: "active" });
    const candidate = byEmailAndPlan.find((s) => s.plan === planId);
    if (candidate) return candidate.id;

    const all = await fetchAllSubscriptions({ status: "active" });
    return all.find((s) => s.plan === planId)?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Verifies a Flutterwave transaction via the verify API and, once confirmed
 * successful, upserts the user's Subscription and flips the checkout's
 * pending PaymentLog to successful. Idempotent — safe to call from both the
 * webhook and the return page confirm path.
 *
 * `userId`, when provided (browser confirm path), scopes the confirmation to
 * the session user's own checkout log. The verified transaction must also
 * match the log's amount and currency.
 */
export async function activateSubscriptionFromTransaction(
  txRef: string,
  txId?: number,
  userId?: string,
): Promise<boolean> {
  const log = await prisma.paymentLog.findUnique({
    where: { txRef },
    include: { user: { select: { email: true } } },
  });
  if (!log || log.source !== "checkout") return false;
  if (userId && log.userId !== userId) return false;

  if (log.status === "successful" && log.flwTxId) {
    return true;
  }

  let verified: FlwTransaction | null = null;
  try {
    verified = txId ? await verifyTransaction(txId) : await verifyTransactionByRef(txRef);
  } catch {
    return false;
  }
  if (!verified || verified.status !== "successful") return false;
  if (verified.currency !== log.currency) return false;
  // Compare numerically: the provider may return the amount as a string.
  if (Number(verified.amount) !== Number(log.amount)) return false;
  // The customer email is deliberately NOT enforced here: this exact codebase
  // ships a fallback because Flutterwave rewrites checkout customer emails on
  // some payment-plan checkouts (e.g. ravesb_<hash>_<original>@gmail.com). The
  // app-generated, unique txRef is what binds the transaction to this log's
  // user, so a rewritten email must never block a confirmed payment.

  const plan = getPlanBySlug(log.planSlug ?? "");
  if (!plan) return false;

  const flwSubscriptionId = await resolveFlwSubscriptionId(log.user.email, plan.flwPlanId);

  const existing = await prisma.subscription.findUnique({
    where: { userId: log.userId },
  });

  const now = new Date();
  const amount = verified.amount ?? log.amount;
  const currency = verified.currency ?? log.currency;

  // Never let two live provider subscriptions bill a user at once. Cancel the
  // stored provider sub whenever we're provably moving away from it: switching
  // to a different plan, or (re)subscribing to the same plan when this checkout
  // created a *new* provider subscription. Idempotent — an already-canceled
  // provider errors out and is swallowed.
  if (
    existing?.flwSubscriptionId &&
    existing.status !== "canceled" &&
    (existing.planSlug !== plan.slug ||
      (flwSubscriptionId && flwSubscriptionId !== existing.flwSubscriptionId))
  ) {
    await cancelSubscription(existing.flwSubscriptionId).catch(() => {});
  }

  // Proration / queueing: whenever the user still has paid access running
  // (currentPeriodEnd in the future — whether the plan is active or was
  // cancelled), the newly purchased plan is appended AFTER the running plan is
  // exhausted. This never discards pre-paid time and never collapses two
  // billing periods into one. When access has already lapsed, the new period
  // starts now.
  const accessEnd = existing?.currentPeriodEnd ? existing.currentPeriodEnd.getTime() : 0;
  const periodStart =
    accessEnd > now.getTime() ? (existing!.currentPeriodEnd as Date) : now;
  const periodEnd = addInterval(periodStart, plan.interval);

  await prisma.$transaction(async (tx) => {
    const subscription = await tx.subscription.upsert({
      where: { userId: log.userId },
      update: {
        flwPlanId: plan.flwPlanId,
        flwSubscriptionId: flwSubscriptionId ?? existing?.flwSubscriptionId ?? null,
        planSlug: plan.slug,
        amount,
        currency,
        status: "active",
        flwCustomerEmail: log.user.email,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        canceledAt: null,
        cancelReason: null,
      },
      create: {
        userId: log.userId,
        flwPlanId: plan.flwPlanId,
        flwSubscriptionId,
        planSlug: plan.slug,
        amount,
        currency,
        status: "active",
        flwCustomerEmail: log.user.email,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
      },
    });

    await tx.paymentLog.update({
      where: { id: log.id },
      data: {
        subscriptionId: subscription.id,
        flwTxId: verified.id,
        status: "successful",
      },
    });
  });

  return true;
}

/**
 * Records a recurring charge (webhook-driven: no checkout PaymentLog for these).
 * Successful renewals also extend the subscription's billing period.
 * Idempotent on txRef so webhook retries don't double-log.
 */
export async function logPaymentCharge(params: {
  email: string;
  txRef: string;
  flwTxId?: number;
  amount?: number;
  currency?: string;
  status: "successful" | "failed";
  source: "checkout" | "recurring";
}): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email: params.email } });
  if (!user) return;

  const existing = await prisma.paymentLog.findUnique({
    where: { txRef: params.txRef },
  });
  if (existing) return;

  const subscription = await prisma.subscription.findUnique({
    where: { userId: user.id },
  });

  if (params.status === "successful" && subscription) {
    const plan = getPlanBySlug(subscription.planSlug);
    if (plan) {
      // Never extend access for a successful recurring charge whose amount
      // doesn't match the subscribed plan — log it as an anomaly instead.
      if (
        params.amount !== undefined &&
        params.amount !== plan.amount
      ) {
        await prisma.paymentLog.create({
          data: {
            userId: user.id,
            subscriptionId: subscription.id,
            txRef: params.txRef,
            flwTxId: params.flwTxId,
            amount: params.amount,
            currency: params.currency ?? subscription.currency,
            planSlug: subscription.planSlug,
            status: "failed",
            source: params.source,
          },
        });
        return;
      }

      const now = new Date();
      // Extend from the current period end when it's still in the future, so
      // carried-over credit from a plan switch is never collapsed. Only fall
      // back to "now" when access has actually lapsed.
      const anchor =
        subscription.currentPeriodEnd &&
        subscription.currentPeriodEnd.getTime() > now.getTime()
          ? subscription.currentPeriodEnd
          : now;
      await prisma.$transaction(async (tx) => {
        await tx.subscription.update({
          where: { id: subscription.id },
          data: {
            status: "active",
            currentPeriodStart: now,
            currentPeriodEnd: addInterval(anchor, plan.interval),
          },
        });
        await tx.paymentLog.create({
          data: {
            userId: user.id,
            subscriptionId: subscription.id,
            txRef: params.txRef,
            flwTxId: params.flwTxId,
            amount: params.amount ?? subscription.amount,
            currency: params.currency ?? subscription.currency,
            planSlug: subscription.planSlug,
            status: "successful",
            source: params.source,
          },
        });
      });
      return;
    }
  }

  await prisma.paymentLog.create({
    data: {
      userId: user.id,
      subscriptionId: subscription?.id,
      txRef: params.txRef,
      flwTxId: params.flwTxId,
      amount: params.amount ?? subscription?.amount ?? 0,
      currency: params.currency ?? subscription?.currency ?? "NGN",
      planSlug: subscription?.planSlug,
      status: params.status,
      source: params.source,
    },
  });
}

/** Marks the user's subscription canceled following Flutterwave's subscription.cancelled event. */
export async function markSubscriptionCanceled(
  customerEmail: string,
  planId?: number,
  subscriptionId?: number,
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email: customerEmail } });
  if (!user) return;

  // Match by provider subscription id when the event carries one, so a late
  // cancellation event for a *previous* subscription can never clobber a plan
  // the user has since reactivated. Fall back to the plan id otherwise.
  if (typeof subscriptionId === "number") {
    await prisma.subscription.updateMany({
      where: { userId: user.id, flwSubscriptionId: subscriptionId },
      data: { status: "canceled", canceledAt: new Date() },
    });
    return;
  }

  if (typeof planId === "number") {
    await prisma.subscription.updateMany({
      where: { userId: user.id, flwPlanId: planId, status: "active" },
      data: { status: "canceled", canceledAt: new Date() },
    });
  }
}

/** Cancels the subscription on Flutterwave and locally, keeping access until period end. */
export async function cancelUserSubscription(userId: string, cancelReason?: string) {
  const subscription = await prisma.subscription.findUnique({ where: { userId } });
  if (!subscription) return { error: "No subscription found." } as const;
  if (subscription.status === "canceled") {
    return { error: "This subscription is already canceled." } as const;
  }
  if (!subscription.flwSubscriptionId) {
    return { error: "Subscription is missing its payment provider reference." } as const;
  }

  try {
    await cancelSubscription(subscription.flwSubscriptionId);
  } catch {
    return { error: "Could not cancel the subscription with the payment provider." } as const;
  }

  await prisma.subscription.update({
    where: { id: subscription.id },
    data: { status: "canceled", canceledAt: new Date(), cancelReason },
  });

  return { ok: true, currentPeriodEnd: subscription.currentPeriodEnd } as const;
}