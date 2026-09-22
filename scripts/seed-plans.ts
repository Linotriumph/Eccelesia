/**
 * One-time setup: creates the two Flutterwave payment plans (monthly + yearly)
 * and prints the plan IDs to paste into lib/plans.ts.
 *
 * Flutterwave charges in whole naira (major units), NOT kobo.
 * Run with: npx tsx scripts/seed-plans.ts
 */
import "dotenv/config";
import {
  cancelPaymentPlan,
  createPaymentPlan,
  getPaymentPlans,
} from "../lib/flutterwave";

const PLANS_TO_SEED = [
  { slug: "monthly", name: "Eccelesia Monthly", amount: 10_000, interval: "monthly" },
  { slug: "yearly", name: "Eccelesia Yearly", amount: 100_000, interval: "yearly" },
];

async function main() {
  const existing = await getPaymentPlans().catch(() => []);

  for (const plan of PLANS_TO_SEED) {
    const existingPlan = existing.find(
      (p) => p.name === plan.name && p.status === "active",
    );

    if (
      existingPlan &&
      existingPlan.amount === plan.amount &&
      existingPlan.interval === plan.interval
    ) {
      console.log(`SKIP  ${plan.slug}: already correct with plan ID ${existingPlan.id}`);
      continue;
    }

    if (existingPlan) {
      console.log(
        `CANCEL ${plan.slug}: plan ${existingPlan.id} has wrong amount ` +
          `${existingPlan.amount} (${plan.interval})`,
      );
      await cancelPaymentPlan(existingPlan.id);
    }

    const created = await createPaymentPlan({
      name: plan.name,
      amount: plan.amount,
      interval: plan.interval,
      currency: "NGN",
    });
    console.log(`CREATED ${plan.slug}: plan ID ${created.id}`);
  }

  console.log("\nUpdate lib/plans.ts flwPlanId fields with the IDs above.");
}

main()
  .catch((err) => {
    console.error("Failed to seed payment plans:", err);
    process.exit(1);
  });