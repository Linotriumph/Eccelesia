import { hashPassword, verifyPassword } from "./auth";
import { prisma } from "./prisma";

const VERIFICATION_CODE_TTL_MS = 1000 * 60 * 15; // 15 minutes

/** Cryptographically secure 6-digit code using the Web Crypto API (Edge-safe). */
export function generateVerificationCode(): string {
  const buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  const value = (buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3];
  return String(Math.abs(value) % 1_000_000).padStart(6, "0");
}

/** Marks any expired, unused codes so expiry is visible in the database. */
async function invalidateExpired(userId: string) {
  await prisma.emailVerification.updateMany({
    where: { userId, usedAt: null, expiredAt: null, expiresAt: { lte: new Date() } },
    data: { expiredAt: new Date() },
  });
}

/** Marks all expired, unused codes for every user. Used by the background sweep. */
export async function sweepExpiredCodes() {
  await prisma.emailVerification.updateMany({
    where: { usedAt: null, expiredAt: null, expiresAt: { lte: new Date() } },
    data: { expiredAt: new Date() },
  });
}

/**
 * Marks any previous unused codes as used, stores a fresh bcrypt-hashed code,
 * and returns the plain code so the caller can email it.
 */
export async function createEmailVerification(userId: string): Promise<string> {
  const code = generateVerificationCode();

  await invalidateExpired(userId);

  await prisma.$transaction([
    prisma.emailVerification.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.emailVerification.create({
      data: {
        userId,
        code,
        codeHash: await hashPassword(code),
        expiresAt: new Date(Date.now() + VERIFICATION_CODE_TTL_MS),
      },
    }),
  ]);

  return code;
}

/**
 * Validates a submitted code against the user's latest unused, unexpired record.
 * On success marks the record used and sets emailVerified. Returns an error string
 * or null on success.
 */
export async function verifyEmailCode(userId: string, code: string): Promise<string | null> {
  await invalidateExpired(userId);

  const record = await prisma.emailVerification.findFirst({
    where: { userId, usedAt: null, expiredAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });

  if (!record) return "Your verification code has expired. Please request a new one.";
  if (!(await verifyPassword(code, record.codeHash))) {
    return "That code is incorrect. Please try again.";
  }

  await prisma.$transaction([
    prisma.emailVerification.update({
      where: { id: record.id },
      data: { usedAt: new Date(), code: null },
    }),
    prisma.user.update({ where: { id: userId }, data: { emailVerified: true } }),
  ]);

  return null;
}
