"use client";

import Link from "next/link";
import { useState } from "react";
import { ensureCsrfToken } from "@/lib/csrf-client";

interface PlanQueueConflict {
  code: string;
  running: { planSlug: string; name: string; accessUntil: string };
  target: { planSlug: string; name: string };
  startsAfter: string;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-NG", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function SubscribeButton({
  planSlug,
  label = "Subscribe",
}: {
  planSlug: string;
  label?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState<PlanQueueConflict | null>(null);
  const [blocked, setBlocked] = useState<{ code: string; message: string } | null>(
    null,
  );

  async function handleSubscribe(confirmed = false) {
    setLoading(true);
    setError("");
    setConflict(null);
    setBlocked(null);
    try {
      const token = await ensureCsrfToken();
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
        body: JSON.stringify({ planSlug, confirmed }),
      });
      const data = await res.json();
      if (res.status === 409 && data?.code === "PLAN_QUEUE_CONFIRMATION_REQUIRED") {
        setConflict(data);
        return;
      }
      if (res.status === 409 && data?.code) {
        setBlocked({ code: data.code, message: data.error });
        return;
      }
      if (!res.ok || !data.url) {
        setError(data.error || "Could not start checkout.");
        return;
      }
      window.location.href = data.url;
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleResetInProgress() {
    setLoading(true);
    setError("");
    try {
      const token = await ensureCsrfToken();
      const res = await fetch("/api/checkout", {
        method: "DELETE",
        headers: { "X-CSRF-Token": token },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not cancel the previous payment.");
        return;
      }
      setBlocked(null);
      await handleSubscribe(false);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (conflict) {
    const isResubscribe = conflict.running.planSlug === planSlug;
    return (
      <div className="confirm-box">
        <p className="confirm-text">
          Your {conflict.running.name} plan is cancelled but still running until{" "}
          {formatDate(conflict.running.accessUntil)}.{" "}
          {isResubscribe
            ? `Resubscribing to ${conflict.target.name} adds a new billing period starting ${formatDate(conflict.startsAfter)} — you won't be double-billed.`
            : `Switching to ${conflict.target.name} starts the new plan after ${formatDate(conflict.startsAfter)} — no paid time is lost.`}
        </p>
        <div className="confirm-actions">
          <button
            type="button"
            className="form-button center secondary"
            onClick={() => setConflict(null)}
            disabled={loading}
          >
            Keep current plan
          </button>
          <button
            type="button"
            className="form-button center"
            onClick={() => handleSubscribe(true)}
            disabled={loading}
          >
            {loading ? "Opening payment..." : "Approve & continue to payment"}
          </button>
        </div>
        {error && <p className="field-error">{error}</p>}
      </div>
    );
  }

  if (blocked?.code === "PAYMENT_IN_PROGRESS") {
    return (
      <div className="confirm-box">
        <p className="confirm-text">{blocked.message}</p>
        <div className="confirm-actions">
          <button
            type="button"
            className="form-button center secondary"
            onClick={() => setBlocked(null)}
            disabled={loading}
          >
            Keep the pending payment
          </button>
          <button
            type="button"
            className="form-button center"
            onClick={handleResetInProgress}
            disabled={loading}
          >
            {loading
              ? "Starting a new checkout..."
              : "Cancel previous payment & start a new checkout"}
          </button>
        </div>
        {error && <p className="field-error">{error}</p>}
      </div>
    );
  }

  if (blocked?.code === "PREVIOUS_PAYMENT_COMPLETED") {
    return (
      <div className="confirm-box">
        <p className="confirm-text">{blocked.message}</p>
        <div className="confirm-actions">
          <Link href="/dashboard/billing" className="form-button center secondary">
            Go to billing
          </Link>
          <button
            type="button"
            className="form-button center"
            onClick={() => setBlocked(null)}
          >
            Continue browsing plans
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        className="form-button"
        onClick={() => handleSubscribe(false)}
        disabled={loading}
      >
        {loading ? "Redirecting to payment..." : label}
      </button>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}