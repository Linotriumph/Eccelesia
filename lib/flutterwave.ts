const FLW_API = "https://api.flutterwave.com/v3";

interface FlwOk<T> {
  status: "success";
  message: string;
  data: T;
  meta?: Record<string, unknown>;
}

interface FlwError {
  status: "error";
  message: string;
  data?: unknown;
}

type FlwResponse<T> = FlwOk<T> | FlwError;

export class FlutterwaveError extends Error {
  constructor(message: string, readonly response?: unknown) {
    super(message);
    this.name = "FlutterwaveError";
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${FLW_API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new FlutterwaveError(`Flutterwave API error (${res.status}): ${body}`);
  }

  const body = (await res.json()) as FlwResponse<T>;
  if (body.status === "error") {
    throw new FlutterwaveError(body.message, body);
  }
  return body.data;
}

/** POST — the raw request carries an extra method field for GET/PUT overrides. */
export async function flwPost<T>(
  path: string,
  payload: Record<string, unknown>,
): Promise<T> {
  return request<T>(path, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function flwPut<T>(
  path: string,
  payload?: Record<string, unknown>,
): Promise<T> {
  return request<T>(path, {
    method: "PUT",
    body: payload ? JSON.stringify(payload) : undefined,
  });
}

export async function flwGet<T>(path: string): Promise<T> {
  return request<T>(path, { method: "GET" });
}

/* ------------------------------ Payment plans ----------------------------- */

export interface FlwPaymentPlan {
  id: number;
  name: string;
  amount: number;
  interval: string;
  duration: number;
  status: string;
  currency: string;
  plan_token: string;
  created_at: string;
}

export function createPaymentPlan(data: {
  amount: number;
  name: string;
  interval: string;
  currency?: string;
}): Promise<FlwPaymentPlan> {
  return flwPost("/payment-plans", data);
}

export function getPaymentPlans(): Promise<FlwPaymentPlan[]> {
  return flwGet("/payment-plans");
}

export function cancelPaymentPlan(id: number): Promise<unknown> {
  return flwPut(`/payment-plans/${id}/cancel`);
}

/* --------------------------------- Checkout ------------------------------- */

export interface FlwCheckoutSession {
  link: string;
}

/** Standard Checkout — returns a hosted payment link to redirect the user to. */
export function createCheckoutSession(data: {
  tx_ref: string;
  amount: number;
  currency?: string;
  redirect_url: string;
  customer: { email: string; name?: string; phonenumber?: string };
  payment_plan?: number;
  customizations?: { title?: string; description?: string; logo?: string };
  payment_options?: string;
  meta?: Record<string, unknown>;
}): Promise<FlwCheckoutSession> {
  return flwPost("/payments", data);
}

/* ------------------------------ Transactions ------------------------------ */

export interface FlwTransaction {
  id: number;
  tx_ref: string;
  amount: number;
  currency: string;
  status: string;
  payment_type: string;
  created_at: string;
  customer?: { id: number; email: string; name?: string | null };
  payment_plan?: number;
  plan?: number;
}

export function verifyTransaction(id: number): Promise<FlwTransaction> {
  return flwGet(`/transactions/${id}/verify`);
}

export function verifyTransactionByRef(txRef: string): Promise<FlwTransaction> {
  return flwGet(`/transactions/${encodeURIComponent(txRef)}/verify`);
}

/* ------------------------------ Subscriptions ----------------------------- */

export interface FlwSubscription {
  id: number;
  amount: number;
  customer: { id: number; customer_email: string };
  plan: number;
  status: string;
  created_at: string;
}

export function cancelSubscription(id: number): Promise<unknown> {
  return flwPut(`/subscriptions/${id}/cancel`);
}

export function fetchAllSubscriptions(params?: {
  email?: string;
  status?: string;
  page?: number;
}): Promise<FlwSubscription[]> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined) qs.set(k, String(v));
  }
  const query = qs.toString();
  return flwGet(`/subscriptions${query ? `?${query}` : ""}`);
}