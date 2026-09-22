import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasActiveAccess } from "@/lib/subscriptions";
import { formatAmount } from "@/lib/plans";
import VerifyEmailForm from "./VerifyEmailForm";

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) return null;

  const subscription = await prisma.subscription.findUnique({
    where: { userId: user.id },
  });

  const active = hasActiveAccess(subscription ?? {
    status: "none",
    currentPeriodEnd: null,
  });
  const planLabel = subscription ? capitalize(subscription.planSlug) : "Free";

  return (
    <div className="dashboard-content">
      <h1 className="dashboard-title">Dashboard</h1>
      <p className="dashboard-subtitle">
        Welcome back, {[user.firstName, user.lastName].filter(Boolean).join(" ")}.
      </p>

      <div className="dashboard-card">
        <h2 className="dashboard-card-title">Account</h2>
        <p className="dashboard-card-text">Signed in as {user.email}.</p>
        {!user.emailVerified && (
          <div className="dashboard-verify">
            <VerifyEmailForm />
          </div>
        )}
      </div>

      <div className="dashboard-card">
        <h2 className="dashboard-card-title">Subscription</h2>
        <p className="dashboard-card-text">
          Current plan: <strong>{planLabel}</strong>
        </p>
        {subscription && (
          <p className="dashboard-card-text">
            {active
              ? subscription.status === "canceled"
                ? `Access until ${subscription.currentPeriodEnd?.toLocaleDateString() ?? "no date"} · ${formatAmount(subscription.amount)}/cycle`
                : `Renews ${subscription.currentPeriodEnd?.toLocaleDateString() ?? "soon"} · ${formatAmount(subscription.amount)}/cycle`
              : `No active subscription at ${formatAmount(subscription.amount)}/cycle`}
          </p>
        )}
        <div className="dashboard-card-actions">
          <Link href="/dashboard/plans" className="form-button center secondary">
            View plans
          </Link>
          {subscription && (
            <Link href="/dashboard/billing" className="form-button center secondary">
              Manage billing
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}