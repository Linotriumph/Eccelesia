import { cookies } from "next/headers";
import { hash, compare } from "bcrypt";

import { prisma } from "./prisma";

const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const BCRYPT_COST = 12;

export function hashPassword(password: string): Promise<string> {
  return hash(password, BCRYPT_COST);
}

export function verifyPassword(password: string, stored: string): Promise<boolean> {
  return compare(password, stored);
}

export async function createSession(userId: string) {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
  await prisma.session.create({
    data: {
      token,
      userId,
      expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
    },
  });
  const cookieStore = await cookies();
  cookieStore.set("session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DURATION_MS / 1000,
  });
}

/** Reuses the user's most recent unexpired session (idempotent login), else creates one. */
export async function getOrCreateSession(userId: string) {
  const cookieStore = await cookies();

  const existing = await prisma.session.findFirst({
    where: { userId, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });

  const token = existing?.token ?? Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");

  if (existing) {
    await prisma.session.update({
      where: { id: existing.id },
      data: { expiresAt: new Date(Date.now() + SESSION_DURATION_MS) },
    });
  } else {
    await prisma.session.create({
      data: {
        token,
        userId,
        expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
      },
    });
  }

  cookieStore.set("session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DURATION_MS / 1000,
  });
}

export async function getSessionUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get("session")?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { token },
    include: {
      user: {
        select: { id: true, firstName: true, middleName: true, lastName: true, email: true, emailVerified: true },
      },
    },
  });
  if (!session || session.expiresAt < new Date()) return null;

  return session.user;
}