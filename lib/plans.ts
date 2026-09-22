export interface Plan {
  slug: string;
  name: string;
  amount: number; // in whole naira (Flutterwave charges major units)
  interval: "monthly" | "yearly";
  flwPlanId: number; // Flutterwave payment plan ID — paste after running seed-plans.ts
}

export const PLANS: Plan[] = [
  {
    slug: "monthly",
    name: "Monthly",
    amount: 10_000, // ₦10,000
    interval: "monthly",
    flwPlanId: 243521,
  },
  {
    slug: "yearly",
    name: "Yearly",
    amount: 100_000, // ₦100,000
    interval: "yearly",
    flwPlanId: 243522,
  },
];

export function getPlanBySlug(slug: string): Plan | undefined {
  return PLANS.find((p) => p.slug === slug);
}

export function formatAmount(amount: number): string {
  return `₦${amount.toLocaleString("en-NG")}`;
}