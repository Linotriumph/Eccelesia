import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { activateSubscriptionFromTransaction } from "@/lib/subscriptions";
import { requireCsrf } from "@/lib/csrf";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Called by the checkout return page after payment.
 * Webhooks are the source of truth in production, but in local dev
 * Flutterwave can't reach localhost, so this endpoint acts as a fallback:
 * it verifies the transaction with Flutterwave and syncs the DB.
 */
export async function POST(request: Request) {
  const blocked = rateLimit(request, "confirm");
  if (blocked) return blocked;
  const csrfBlocked = requireCsrf(request);
  if (csrfBlocked) return csrfBlocked;

  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const { tx_ref, transaction_id } = body ?? {};
  if (typeof tx_ref !== "string") {
    return NextResponse.json({ error: "Missing tx_ref." }, { status: 400 });
  }

  const ok = await activateSubscriptionFromTransaction(
    tx_ref,
    typeof transaction_id === "number" ? transaction_id : undefined,
    user.id,
  );

  return NextResponse.json({ verified: ok });
}