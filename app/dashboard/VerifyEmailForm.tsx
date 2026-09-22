"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ensureCsrfToken } from "@/lib/csrf-client";

export default function VerifyEmailForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [countdown, setCountdown] = useState(60);

  function restartCountdown() {
    setCountdown(60);
  }

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  async function handleSubmit(action: "verify" | "resend") {
    setError("");
    setInfo("");
    setLoading(action === "verify");
    setResending(action === "resend");
    try {
      const token = await ensureCsrfToken();

      const res = await fetch("/api/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
        body: JSON.stringify(action === "verify" ? { code } : { resend: true }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Something went wrong.");
        if (data.error?.includes("expired")) restartCountdown();
        return;
      }

      if (action === "verify") {
        setCode("");
        setInfo("Email verified. Welcome!");
        router.refresh();
      } else {
        setInfo("A new code has been sent to your email.");
        restartCountdown();
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
      setResending(false);
    }
  }

  function handleVerify(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    handleSubmit("verify");
  }

  return (
    <div>
      <p className="auth-subtitle">
        A 6-digit verification code was emailed to you. Enter it below to verify your email.
      </p>
      <form onSubmit={handleVerify} noValidate>
        <div className="form-group">
          <label htmlFor="code">Verification code</label>
          <input
            id="code"
            type="text"
            inputMode="numeric"
            maxLength={6}
            className={`form-input${error ? " form-input-error" : ""}`}
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
              setError("");
            }}
            required
            autoComplete="one-time-code"
          />
          {error && <p className="field-error">{error}</p>}
        </div>
        {info && <p className="form-success">{info}</p>}
        <button type="submit" className="form-button" disabled={loading || code.length !== 6}>
          {loading ? "Verifying..." : "Verify email"}
        </button>
      </form>
      <button
        type="button"
        className="form-link"
        onClick={() => handleSubmit("resend")}
        disabled={resending || countdown > 0}
      >
        {resending
          ? "Sending..."
          : countdown > 0
            ? `Resend code in ${countdown}s`
            : "Resend code"}
      </button>
    </div>
  );
}