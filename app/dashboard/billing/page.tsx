import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasActiveAccess } from "@/lib/subscriptions";
import { formatAmount } from "@/lib/plans";
import CancelButton from "./CancelButton";
import CancellationAlert from "./CancellationAlert";

export const dynamic = "force-dynamic";

function statusLabel(status: string, active: boolean): string {
  if (!active) return "Expired";
  if (status === "canceled") return "Canceled";
  return "Active";
}

interface Props {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function BillingPage({ searchParams }: Props) {
  const sp = await searchParams;
  const cancelled = sp.cancelled === "1";
  const user = await getSessionUser();
  if (!user) redirect("/");

  const subscription = await prisma.subscription.findUnique({
    where: { userId: user.id },
  });

  if (!subscription) {
    return (
      <div className="dashboard-content center">
        <h1 className="dashboard-title">No subscription</h1>
        <p className="dashboard-subtitle">
          You are currently on the Free plan.
        </p>
        <Link href="/dashboard/plans" className="form-button center secondary">
          Choose a plan
        </Link>
      </div>
    );
  }

  const active = hasActiveAccess(subscription);
  const planName = capitalize(subscription.planSlug);
  const nextRenewal = subscription.currentPeriodEnd?.toLocaleDateString("en-NG", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="dashboard-content">
      <CancellationAlert visible={cancelled} />
      <h1 className="dashboard-title">Billing</h1>
      <p className="dashboard-subtitle">
        Manage your subscription and billing details.
      </p>

      <div className="dashboard-card">
        <h2 className="dashboard-card-title">Subscription</h2>

        <dl className="billing-info">
          <div className="billing-row">
            <dt>Plan</dt>
            <dd>{planName}</dd>
          </div>
          <div className="billing-row">
            <dt>Amount</dt>
            <dd>
              {formatAmount(subscription.amount)}{" "}
              {subscription.planSlug === "monthly" ? "/ month" : "/ year"}
            </dd>
          </div>
          <div className="billing-row">
            <dt>Status</dt>
            <dd>
              <span
                className={`status-badge${active ? " active" : ""}${
                  subscription.status === "canceled" && active ? " canceled" : ""
                }`}
              >
                {statusLabel(subscription.status, active)}
              </span>
            </dd>
          </div>
          <div className="billing-row">
            <dt>{subscription.status === "canceled" ? "Access until" : "Renews on"}</dt>
            <dd>{nextRenewal ?? "—"}</dd>
          </div>
        </dl>

        <div className="billing-actions">
          {active && subscription.status !== "canceled" ? (
            <CancelButton />
          ) : (
            <Link href="/dashboard/plans" className="form-button center secondary">
              Resubscribe
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}