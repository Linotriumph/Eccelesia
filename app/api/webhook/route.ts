import { NextResponse } from "next/server";
import {
  activateSubscriptionFromTransaction,
  logPaymentCharge,
  markSubscriptionCanceled,
} from "@/lib/subscriptions";
import { prisma } from "@/lib/prisma";
import {
  verifyTransaction,
  verifyTransactionByRef,
  type FlwTransaction,
} from "@/lib/flutterwave";

/**
 * Re-verifies a charge with Flutterwave's verify API. Webhook payloads alone
 * are never trusted: `verif-hash` proves the request came from Flutterwave,
 * and this second check proves the transaction actually exists and is in the
 * claimed state before any access is granted.
 */
async function verifyCharge(id?: number, txRef?: string): Promise<FlwTransaction | null> {
  try {
    if (id) return await verifyTransaction(id);
    if (txRef) return await verifyTransactionByRef(txRef);
    return null;
  } catch {
    return null;
  }
}

/** Flutterwave webhook — no CSRF (not browser-initiated), verif-hash only. */
export async function POST(request: Request) {
  const secretHash = process.env.FLW_SECRET_HASH;
  const signature = request.headers.get("verif-hash");
  if (!secretHash || !signature || signature !== secretHash) {
    return new NextResponse(null, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  if (!payload?.event) {
    return new NextResponse(null, { status: 200 });
  }

  const { event, data } = payload;

  if (event === "charge.completed") {
    const verified = await verifyCharge(data?.id, data?.tx_ref);

    if (data?.status === "successful" || verified?.status === "successful") {
      // Trust the verified transaction when it's available; fall back to the
      // payload only when the payload itself says successful but the API call
      // failed (transient network hiccup) — never grant access off a mismatch.
      const status = verified?.status;
      if (status === "failed") {
        return new NextResponse(null, { status: 200 });
      }
      const txRef = verified?.tx_ref ?? data?.tx_ref;
      const flwTxId = verified?.id ?? data?.id;
      const email =
        verified?.customer?.email ?? data?.customer?.email;

      if (txRef && email) {
        // Checkout with a pending PaymentLog → activate + flip to successful.
        // Otherwise it's a recurring subscription charge → log + extend the
        // billing period (skips if a payment log already exists for the txRef).
        const handled = await activateSubscriptionFromTransaction(
          txRef,
          flwTxId,
        ).catch(() => false);

        if (!handled) {
          await logPaymentCharge({
            email,
            txRef,
            flwTxId,
            amount: verified?.amount ?? data?.amount,
            currency: verified?.currency ?? data?.currency,
            status: "successful",
            source: "recurring",
          }).catch(() => {});
        }
      }
    } else if (data?.status === "failed" || (verified && verified.status !== "successful")) {
      const txRef: string | undefined = data?.tx_ref;
      if (txRef) {
        await prisma.paymentLog
          .updateMany({ where: { txRef, source: "checkout" }, data: { status: "failed" } })
          .catch(() => {});

        const email = data?.customer?.email;
        if (email) {
          await logPaymentCharge({
            email,
            txRef,
            flwTxId: data?.id,
            amount: data?.amount,
            currency: data?.currency,
            status: "failed",
            source: typeof data?.payment_plan === "number" ? "recurring" : "checkout",
          }).catch(() => {});
        }
      }
    }
  } else if (event === "subscription.cancelled" && data?.customer?.email && data?.plan?.id) {
    await markSubscriptionCanceled(data.customer.email, data.plan.id, data?.id).catch(
      () => {},
    );
  }

  return new NextResponse(null, { status: 200 });
}