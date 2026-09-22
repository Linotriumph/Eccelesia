const CSRF_COOKIE = "csrf";

export function readCsrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export async function ensureCsrfToken(): Promise<string> {
  const fromCookie = readCsrfToken();
  if (fromCookie) return fromCookie;

  const res = await fetch("/api/csrf");
  if (!res.ok) return "";
  const data = await res.json();
  return (data.token as string) ?? "";
}