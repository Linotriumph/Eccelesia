"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ensureCsrfToken } from "@/lib/csrf-client";

export default function SignOutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleSignOut() {
    setLoading(true);
    try {
      const token = await ensureCsrfToken();
      await fetch("/api/logout", {
        method: "POST",
        headers: { "X-CSRF-Token": token },
      });
    } finally {
      router.push("/");
      router.refresh();
    }
  }

  return (
    <button type="button" className="form-button center secondary" onClick={handleSignOut} disabled={loading}>
      {loading ? "Signing out..." : "Sign out"}
    </button>
  );
}