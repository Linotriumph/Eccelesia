import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { hasActiveAccess } from "@/lib/subscriptions";
import { formatAmount } from "@/lib/plans";
import SubscribeButton from "./SubscribeButton";

const YEARLY_SAVINGS = 1 - 100_000 / (10_000 * 12); // ~17% vs monthly

export default async function PlansPage() {
  const user = await getSessionUser();
  if (!user) redirect("/");

  const subscription = await prisma.subscription.findUnique({
    where: { userId: user.id },
  });

  const active = hasActiveAccess(
    subscription ?? { status: "none", currentPeriodEnd: null },
  );
  const runningCanceled = active && subscription?.status === "canceled";
  const currentSlug = active && !runningCanceled ? subscription?.planSlug : null;
  const accessUntil = subscription?.currentPeriodEnd?.toLocaleDateString("en-NG", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="dashboard-content">
      <h1 className="dashboard-title">Plans</h1>
      <p className="dashboard-subtitle">
        Choose a plan that fits your needs. Switch or cancel anytime.
      </p>

      {runningCanceled && subscription && (
        <div className="dashboard-card">
          <h2 className="dashboard-card-title">
            Your {capitalize(subscription.planSlug)} plan is cancelled but still
            running
          </h2>
          <p className="dashboard-card-text">
            You keep access until {accessUntil}. Any plan you buy now is added
            after that date — no paid time is lost and you will never be
            double-billed for the same period.
          </p>
        </div>
      )}

      <div className="plan-cards">
        <div className={`plan-card${active ? "" : " current"}`}>
          <h2 className="plan-card-name">Free</h2>
          <p className="plan-card-price">₦0</p>
          <p className="plan-card-interval">forever</p>
          <p className="plan-card-desc">Get started with basic access.</p>
          {!active ? (
            <span className="plan-badge">Current plan</span>
          ) : (
            <span className="plan-card-disabled">Your plan</span>
          )}
        </div>

        {["monthly", "yearly"].map((slug) => {
          const price =
            slug === "monthly" ? 10_000 : 100_000;
          const intervalLabel = slug === "monthly" ? "per month" : "per year";
          const desc =
            slug === "monthly"
              ? "Full access, billed monthly."
              : "Full access, billed yearly. Save " +
                `${Math.round(YEARLY_SAVINGS * 100)}%`;
          const isCurrent = currentSlug === slug;
          const planName = capitalize(slug);

          let note: string | null = null;
          let label = "Subscribe";

          if (!isCurrent) {
            if (runningCanceled) {
              if (subscription?.planSlug === slug) {
                label = "Resubscribe";
                note = `Your ${planName} subscription is cancelled but still running until ${accessUntil}. Resubscribing adds a new period after that date — no double billing.`;
              } else {
                label = slug === "yearly" ? "Upgrade" : "Downgrade";
                note = `Your ${capitalize(subscription?.planSlug ?? "")} plan continues until ${accessUntil}. Your new ${planName} plan starts after that date and no paid time is lost.`;
              }
            } else if (currentSlug) {
              label = slug === "yearly" ? "Upgrade" : "Downgrade";
              note = `Switching cancels your ${capitalize(currentSlug)} plan and bills you now. Your remaining paid time carries over.`;
            }
          }

          return (
            <div key={slug} className={`plan-card${isCurrent ? " current" : ""}`}>
              {slug === "yearly" && (
                <span className="plan-badge popular">Most popular</span>
              )}
              <h2 className="plan-card-name">{planName}</h2>
              <p className="plan-card-price">{formatAmount(price)}</p>
              <p className="plan-card-interval">{intervalLabel}</p>
              <p className="plan-card-desc">{desc}</p>
              {isCurrent ? (
                <span className="plan-card-disabled">Current plan</span>
              ) : (
                <>
                  {note && <p className="plan-card-note">{note}</p>}
                  <SubscribeButton planSlug={slug} label={label} />
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}