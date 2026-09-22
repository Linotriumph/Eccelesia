"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ensureCsrfToken } from "@/lib/csrf-client";

interface Props {
  initialStatus?: string;
  txRef?: string;
  transactionId?: string;
}

export default function CheckoutReturnView({
  initialStatus,
  txRef,
  transactionId,
}: Props) {
  const [confirmed, setConfirmed] = useState<boolean | null>(null);

  const isSuccessful = initialStatus === "successful";
  const isFailure =
    !initialStatus || initialStatus === "failed" || initialStatus === "cancelled";

  useEffect(() => {
    if (!isSuccessful || !txRef) return;
    let cancelled = false;

    const idNumber = transactionId ? Number(transactionId) : undefined;
    const run = async () => {
      const token = await ensureCsrfToken();
      const res = await fetch("/api/subscription/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
        body: JSON.stringify({
          tx_ref: txRef,
          transaction_id: Number.isFinite(idNumber) ? idNumber : undefined,
        }),
      });
      const data = await res.json();
      return Boolean(data.verified);
    };

    const confirmWithRetry = async () => {
      let ok = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        ok = await run().catch(() => false);
        if (ok) break;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      if (!cancelled) setConfirmed(ok);
    };
    confirmWithRetry();
    return () => {
      cancelled = true;
    };
  }, [isSuccessful, txRef, transactionId]);

  if (isFailure) {
    return (
      <div className="dashboard-content center">
        <h1 className="dashboard-title">Payment not completed</h1>
        <p className="dashboard-subtitle">
          Your payment was not completed. You can try again.
        </p>
        <Link href="/dashboard/plans" className="form-button center secondary">
          Back to plans
        </Link>
      </div>
    );
  }

  if (confirmed === null) {
    return (
      <div className="dashboard-content center">
        <h1 className="dashboard-title">Processing your payment...</h1>
        <p className="dashboard-subtitle">
          Please wait while we confirm your payment.
        </p>
      </div>
    );
  }

  if (!confirmed) {
    return (
      <div className="dashboard-content center">
        <h1 className="dashboard-title">Payment not confirmed</h1>
        <p className="dashboard-subtitle">
          We could not confirm your payment yet. Please check your billing page
          shortly.
        </p>
        <Link href="/dashboard/billing" className="form-button center secondary">
          Go to billing
        </Link>
      </div>
    );
  }

  return (
    <div className="dashboard-content center">
      <h1 className="dashboard-title">Payment successful!</h1>
      <p className="dashboard-subtitle">
        Your subscription is now active. Welcome to Eccelesia.
      </p>
      <Link href="/dashboard/billing" className="form-button center">
        Go to billing
      </Link>
    </div>
  );
}