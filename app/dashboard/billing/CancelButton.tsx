"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ensureCsrfToken } from "@/lib/csrf-client";

export default function CancelButton() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  async function handleCancel() {
    setLoading(true);
    setError("");
    try {
      const token = await ensureCsrfToken();
      const res = await fetch("/api/subscription", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": token,
        },
        body: JSON.stringify({ cancelReason: reason.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not cancel the subscription.");
        return;
      }
      setConfirming(false);
      router.replace("/dashboard/billing?cancelled=1");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (confirming) {
    return (
      <div className="confirm-box">
        <p className="confirm-text">
          Cancel your subscription? You&apos;ll keep access until the end of
          your current billing period.
        </p>
        <div className="form-group">
          <label htmlFor="cancel-reason">
            Why are you cancelling? (optional)
          </label>
          <input
            id="cancel-reason"
            type="text"
            className="form-input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Tell us what went wrong"
            disabled={loading}
          />
        </div>
        <div className="confirm-actions">
          <button
            type="button"
            className="form-button center secondary"
            onClick={() => setConfirming(false)}
            disabled={loading}
          >
            Keep subscription
          </button>
          <button
            type="button"
            className="form-button center danger"
            onClick={handleCancel}
            disabled={loading}
          >
            {loading ? "Canceling..." : "Yes, cancel"}
          </button>
        </div>
        {error && <p className="field-error">{error}</p>}
      </div>
    );
  }

  return (
    <button
      type="button"
      className="form-button center secondary"
      onClick={() => setConfirming(true)}
    >
      Cancel subscription
    </button>
  );
}