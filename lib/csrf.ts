import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";

export const CSRF_COOKIE = "csrf";
const CSRF_MAX_AGE = 60 * 60 * 24; // 1 day

export function newCsrfToken(): string {
  return randomBytes(32).toString("hex");
}

export function getCsrfCookie(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === CSRF_COOKIE) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return null;
}

export function setCsrfCookie(response: NextResponse, token: string) {
  response.cookies.set(CSRF_COOKIE, token, {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: CSRF_MAX_AGE,
  });
}

export function validateCsrf(request: Request): boolean {
  const headerToken = request.headers.get("x-csrf-token");
  if (!headerToken) return false;
  const cookieToken = getCsrfCookie(request);
  return !!cookieToken && headerToken === cookieToken;
}

export function requireCsrf(request: Request): NextResponse | null {
  if (!validateCsrf(request)) {
    return NextResponse.json({ error: "Invalid or missing CSRF token." }, { status: 403 });
  }
  return null;
}