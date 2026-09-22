"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ensureCsrfToken } from "@/lib/csrf-client";

type AuthMode = "signup" | "login" | "reset";

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [showPassword, setShowPassword] = useState(false);

  function switchMode(next: AuthMode) {
    setMode(next);
    setError("");
    setSuccess("");
    setFieldErrors({});
  }

  function fieldLabel(field: string) {
    if (field === "password") return mode === "reset" ? "New password" : "Password";
    if (field === "name") return "Full name";
    return "Email";
  }

  function validateField(field: string, value: string, skipWordCount = false) {
    if (!value.trim()) return `${fieldLabel(field)} field Cannot Be Empty`;
    if (field === "name") {
      if (!/^[A-Za-z\s]+$/.test(value)) return "Full Name Must use Only Letters";
      if (!skipWordCount && value.trim().split(/\s+/).length < 2) {
        return "Full Name Must Contain at Least 2 Words";
      }
    }
    if (field === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return "Enter a Valid Email Address";
    }
    return "";
  }

  const passwordChecks = [
    { label: "Contains a lowercase letter", test: (p: string) => /[a-z]/.test(p) },
    { label: "Contains an uppercase letter", test: (p: string) => /[A-Z]/.test(p) },
    { label: "Contains a number", test: (p: string) => /[0-9]/.test(p) },
    { label: "Contains a special character (#@>^)", test: (p: string) => /[#@>\^]/.test(p) },
    { label: "Minimum of 8 characters", test: (p: string) => p.length >= 8 },
  ];

  function handleFieldBlur(e: React.FocusEvent<HTMLInputElement>) {
    const field = e.target.id;
    setFieldErrors((prev) => ({ ...prev, [field]: validateField(field, e.target.value) }));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setSuccess("");

    const fieldsToCheck = mode === "signup" ? ["name", "email", "password"] : ["email", "password"];
    const values: Record<string, string> = { name, email, password };
    const newErrors: Record<string, string> = {};
    for (const field of fieldsToCheck) {
      const message = validateField(field, values[field]);
      if (message) newErrors[field] = message;
    }
    setFieldErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    setLoading(true);

    try {
      const token = await ensureCsrfToken();

      const path = mode === "signup" ? "/api/register" : mode === "login" ? "/api/login" : "/api/reset-password";
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Something went wrong.");
        return;
      }

      if (mode === "reset") {
        setEmail("");
        setPassword("");
        setSuccess("Password updated. You can now sign in.");
        setMode("login");
        setError("");
        return;
      }

      router.push("/dashboard");
      router.refresh();
      return;
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const fieldsComplete =
    mode === "signup"
      ? name.trim() !== "" && email.trim() !== "" && password.trim() !== ""
      : email.trim() !== "" && password.trim() !== "";

  const unmetPasswordChecks =
    mode === "signup" && password !== ""
      ? passwordChecks.find((check) => !check.test(password))
      : undefined;

  return (
    <div className="auth-page">
      <div className="auth-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          className={mode === "signup" ? "auth-tab active" : "auth-tab"}
          onClick={() => switchMode("signup")}
        >
          Get started
        </button>
        <button
          type="button"
          role="tab"
          className={mode === "login" ? "auth-tab active" : "auth-tab"}
          onClick={() => switchMode("login")}
        >
          Sign in
        </button>
      </div>
      <div className="auth-card">
        <h1 className="auth-title">
          {mode === "signup" ? "Create account" : mode === "login" ? "Welcome back" : "Reset password"}
        </h1>

        <form onSubmit={handleSubmit} noValidate>
          {mode === "signup" && (
            <div className="form-group">
              <label htmlFor="name">Full name</label>
              <input
                id="name"
                type="text"
className={`form-input${fieldErrors.name ? " form-input-error" : ""}`}
                value={name}
                onChange={(e) => {
                  const value = e.target.value;
                  setName(value);
                  setFieldErrors((prev) => ({ ...prev, name: validateField("name", value, true) }));
                }}
                onBlur={handleFieldBlur}
                required
                autoComplete="name"
              />
              {fieldErrors.name && <p className="field-error">{fieldErrors.name}</p>}
            </div>
          )}

          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              className={`form-input${fieldErrors.email ? " form-input-error" : ""}`}
              value={email}
              onChange={(e) => {
                const value = e.target.value.trim();
                setEmail(value);
                setFieldErrors((prev) => ({ ...prev, email: validateField("email", value) }));
              }}
              onBlur={handleFieldBlur}
              required
              autoFocus={mode === "login" || mode === "reset"}
              autoComplete="email"
            />
            {fieldErrors.email && <p className="field-error">{fieldErrors.email}</p>}
          </div>

          <div className="form-group">
            <div className="form-label-row">
              <label htmlFor="password">
                {mode === "reset" ? "New password" : "Password"}
              </label>
              {mode === "login" && (
                <button type="button" className="form-link" onClick={() => switchMode("reset")}>
                  Forgot password?
                </button>
              )}
            </div>
            <div className="password-input-wrapper">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                className={`form-input${fieldErrors.password ? " form-input-error" : ""}`}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value.trim());
                  setFieldErrors((prev) => ({ ...prev, password: "" }));
                }}
                onBlur={handleFieldBlur}
                required
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
              {password !== "" && (
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              )}
            </div>
            {fieldErrors.password && <p className="field-error">{fieldErrors.password}</p>}
            {unmetPasswordChecks && (
              <p className="password-requirements">{unmetPasswordChecks.label}</p>
            )}
          </div>

          {error && <p className="form-error">{error}</p>}
          {success && <p className="form-success">{success}</p>}

          <button type="submit" className="form-button" disabled={loading || !fieldsComplete}>
            {loading
              ? mode === "login"
                ? "Signing in..."
                : mode === "signup"
                  ? "Creating account..."
                  : "Resetting..."
              : mode === "signup"
                ? "Sign up"
                : mode === "login"
                  ? "Sign in"
                  : "Reset password"}
          </button>
        </form>
      </div>
    </div>
  );
}