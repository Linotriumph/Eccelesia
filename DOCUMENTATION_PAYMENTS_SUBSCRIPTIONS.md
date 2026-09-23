# Eccelesia — Subscription & Billing Documentation

---

## 1. What This Is

### Product Area
Eccelesia is a web platform with a subscription, billing, and access-entitlement slice integrated with user authentication.

### Purpose of the Slice
The purpose of this slice is to manage subscription plans, hosted checkouts, payment verification, webhook ingestion, subscription lifecycle states (active, cancelled, expired), plan queuing to preserve paid time, payment event auditing, and access control.

### Major User-Facing Capabilities Actually Implemented
* **Plan Selection**: View available subscription plans (`/dashboard/plans`), including Free (₦0), Monthly (₦10,000/month), and Yearly (₦100,000/year, representing a ~17% discount).
* **Hosted Checkout Flow**: Initiate payment via `/api/checkout` to generate a hosted checkout payment link, with server-side guards preventing duplicate in-flight checkouts.
* **Return & Confirmation**: A dedicated checkout return page (`/dashboard/checkout/return`) that verifies and confirms payments via `/api/subscription/confirm`.
* **Webhook Processing**: Asynchronous webhook handler (`/api/webhook`) that validates provider secret hashes, re-verifies transactions against the provider API, and updates local subscription records.
* **Billing Management**: A billing dashboard (`/dashboard/billing`) displaying current plan name, amount, billing cycle, status badge, renewal date or access expiration date, and a cancellation action.
* **Cancellation with Retained Access**: Users can cancel their subscription at any time with an optional feedback reason. When cancelled, the provider subscription is stopped, the status is set to `canceled`, and paid access is preserved until `currentPeriodEnd`.
* **Plan Switching & Period Queuing**: When resubscribing or switching plans while a previous paid period is active, the system requires confirmation and queues the new subscription period to begin only after the running period expires, preventing double billing and lost time.
* **In-Flight Checkout Management**: Cleans up abandoned or expired pending checkout sessions (30-minute window) and provides an endpoint (`DELETE /api/checkout`) to cancel pending checkouts.
* **Payment Auditing**: Complete lifecycle logging in `PaymentLog` for both checkout sessions and recurring charges.

### Main Technologies Actually Used
* **Framework**: Next.js 16.3.5 (App Router, Server Actions, Route Handlers, React 19)
* **Language**: TypeScript 5
* **ORM & Database**: Prisma ORM 6.19.3 with PostgreSQL
* **Payment Gateway Integration**: Flutterwave v3 API (Hosted Checkout, Verification API, Subscriptions API, Payment Plans API)
* **Authentication & Security**: HTTP-only session cookies with crypto-random tokens, bcrypt password hashing (cost factor 12), double-submit cookie CSRF validation (`lib/csrf.ts`), and in-memory rate limiting (`lib/rate-limit.ts`)
* **Validation**: Zod 4.6.5
* **Email / SMTP**: Nodemailer for email verification codes

### Implementation vs. PRD Distinction
* **Payment Gateway**: The repository implements Flutterwave v3 (`lib/flutterwave.ts`, `flwPlanId`, `flwSubscriptionId`, `flwTxId`, `FLW_SECRET_KEY`, `FLW_SECRET_HASH`). Any reference to Paystack in design prompts is not present in the repository code or schema.
* **Proration Model**: Rather than computing fractional monetary credits or partial-month cash refunds, the codebase implements a **Period-Preserving Queue Model** (`lib/subscriptions.ts`). When an active or cancelled paid plan exists, the newly purchased plan interval is appended directly to `existing.currentPeriodEnd`.
* **Status Model**: The implementation uses `active` and `canceled` statuses with dynamic access evaluation via `hasActiveAccess()`. There is no `PAST_DUE` enum in the database schema or code; expired subscriptions lapse to Free when `currentPeriodEnd < now`.

---

## 2. How To Run It

### Prerequisites
* Node.js (v20+ recommended)
* PostgreSQL database instance

### Verified Setup & Execution Commands
The following commands are defined in `package.json` and the repository configuration:

* **Install dependencies**:
  ```bash
  npm install
  ```

* **Apply database migrations**:
  ```bash
  npx prisma migrate deploy
  ```
  *(For local schema prototyping: `npx prisma migrate dev`)*

* **Seed payment plans (One-time setup with payment provider)**:
  ```bash
  npm run seed-plans
  ```
  *(Executes `tsx scripts/seed-plans.ts` to create the Monthly and Yearly payment plans in Flutterwave and print their IDs to update `lib/plans.ts`)*

* **Run development server**:
  ```bash
  npm run dev
  ```
  *(Starts the Next.js development server at `http://localhost:3000`)*

* **Build for production**:
  ```bash
  npm run build
  ```

* **Run production server**:
  ```bash
  npm start
  ```

* **Linting**:
  ```bash
  npm run lint
  ```

* **Automated Tests**:
  > Not verified from the repository: no automated test runner or test script is configured in `package.json`.

### Environment Variables
Configure the following in `.env` (refer to [`.env.example`](file:///c:/Users/HP/Desktop/Eccelesia/.env.example)):

```ini
# PostgreSQL connection string
DATABASE_URL="postgresql://user:password@localhost:5432/eccelesia"

# Application Base URL
APP_URL="http://localhost:3000"

# Flutterwave API Configuration
FLW_PUBLIC_KEY="FLWPUBK_TEST-..."
FLW_SECRET_KEY="FLWSECK_TEST-..."
FLW_SECRET_HASH="custom_webhook_secret_hash"

# SMTP / Email Transport (for email verification)
SMTP_HOST="smtp.example.com"
SMTP_PORT="587"
SMTP_SECURE="false"
SMTP_USER="user"
SMTP_PASS="password"
SMTP_FROM="noreply@example.com"
```

### Local Webhook Setup
To test webhooks locally:
1. Use a tunneling tool (e.g., ngrok or similar proxy) pointing to `http://localhost:3000`.
2. Set the Flutterwave Webhook URL in your dashboard to `https://<your-tunnel-subdomain>/api/webhook`.
3. Set the Secret Hash in Flutterwave to match `FLW_SECRET_HASH`.
4. *Local Fallback*: If webhook forwarding is unavailable during local development, the return view (`/dashboard/checkout/return`) automatically calls `POST /api/subscription/confirm`, which verifies the transaction directly with the Flutterwave API.

---

## 3. The Flow, Step By Step

### 1. User Registration & Sign In
```text
User fills registration form at /
→ POST /api/register (validates names, email, password; hashes with bcrypt cost 12)
→ Prisma creates User with emailVerified: false
→ lib/auth.ts creates Session (32-byte token, 7-day expiry) in httpOnly 'session' cookie
→ User redirected to /dashboard
```

### 2. Protected Access Check
```text
User navigates to any /dashboard/* route
→ app/dashboard/layout.tsx calls getSessionUser()
→ Checks session cookie against Session table in database
→ If no session or expired: redirect to /
→ If valid: renders dashboard shell with user details
```

### 3. Plan Selection & Checkout Initiation
```text
User clicks 'Subscribe' on Monthly or Yearly at /dashboard/plans
→ SubscribeButton.tsx requests CSRF token via ensureCsrfToken()
→ POST /api/checkout with { planSlug, confirmed: false }
→ API validates rate limit (lib/rate-limit.ts) and CSRF (lib/csrf.ts)
→ API checks user session via getSessionUser()
→ API checks Double-Charge Guard #1: rejects if active non-cancelled subscription exists for same plan
→ API checks Stale Checkout Guard: marks pending PaymentLogs older than 30 mins as 'abandoned'
→ API checks In-Flight Guard: if pending PaymentLog exists < 30 mins, verifies with Flutterwave;
  if already paid, activates subscription and returns 409 (PREVIOUS_PAYMENT_COMPLETED);
  if unpaid, returns 409 (PAYMENT_IN_PROGRESS) with option to cancel via DELETE /api/checkout
→ API checks Plan Queue Guard: if user cancelled but has active access until currentPeriodEnd and confirmed: false,
  returns 409 (PLAN_QUEUE_CONFIRMATION_REQUIRED)
→ If confirmed or new subscriber: creates PaymentLog with status 'pending', source 'checkout', and txRef 'ECC-<userId>-<timestamp>'
→ Calls createCheckoutSession() in lib/flutterwave.ts (POST /payments)
→ Returns hosted checkout URL to frontend
→ Client redirects window.location.href to Flutterwave Hosted Checkout
```

### 4. Payment Execution & Webhook Ingestion
```text
User completes payment on Flutterwave hosted page
→ Flutterwave sends POST /api/webhook with header 'verif-hash'
→ API verifies 'verif-hash' matches process.env.FLW_SECRET_HASH
→ For 'charge.completed': API re-verifies charge via verifyTransaction() / verifyTransactionByRef()
→ If transaction verified successful:
  → activateSubscriptionFromTransaction(txRef, flwTxId) is invoked
  → Upserts Subscription record and marks PaymentLog status as 'successful'
```

### 5. Return Page & Direct Verification Fallback
```text
Flutterwave redirects user browser to /dashboard/checkout/return?status=successful&tx_ref=...&transaction_id=...
→ CheckoutReturnView component mounts and invokes POST /api/subscription/confirm (with 5-attempt retry loop)
→ POST /api/subscription/confirm validates CSRF, rate limit, and session user
→ Calls activateSubscriptionFromTransaction(txRef, transaction_id, user.id)
→ Verifies transaction against Flutterwave API
→ Enforces user isolation (userId must match PaymentLog.userId)
→ Upserts Subscription and updates PaymentLog atomically
→ ReturnView displays 'Payment successful!' and links to /dashboard/billing
```

### 6. Dynamic Access Entitlement
```text
Protected pages or dashboard components check hasActiveAccess(subscription)
→ Returns true if currentPeriodEnd > now AND (status === 'active' OR status === 'canceled')
→ Grants access to paid features
```

### 7. Subscription Cancellation
```text
User clicks 'Cancel subscription' on /dashboard/billing
→ CancelButton.tsx displays confirmation prompt with optional reason input
→ User submits -> DELETE /api/subscription with { cancelReason }
→ Validates CSRF and session user
→ Calls cancelUserSubscription() in lib/subscriptions.ts
→ Calls Flutterwave cancelSubscription(flwSubscriptionId) (PUT /subscriptions/:id/cancel)
→ Updates Subscription in database: status = 'canceled', canceledAt = now, cancelReason = reason
→ Page refreshes with ?cancelled=1 displaying CancellationAlert
→ User continues to receive paid access until currentPeriodEnd
```

### 8. Plan Switching / Resubscribing (Period Queuing)
```text
User with active cancelled plan attempts to resubscribe or switch plans
→ POST /api/checkout returns 409 PLAN_QUEUE_CONFIRMATION_REQUIRED
→ Frontend shows dialogue explaining the new plan will start after the current plan expires
→ User clicks 'Approve & continue to payment' -> POST /api/checkout with confirmed: true
→ Hosted checkout completed
→ activateSubscriptionFromTransaction() sets periodStart = existing.currentPeriodEnd
→ periodEnd = addInterval(periodStart, plan.interval)
→ Paid periods are chained sequentially with zero time lost
```

### 9. Failed or Abandoned Payments
```text
If user abandons payment:
→ PaymentLog remains 'pending' until 30-minute window expires (auto-set to 'abandoned' on next checkout)
  or user clicks 'Cancel previous payment' calling DELETE /api/checkout (sets status to 'abandoned')
If webhook delivers charge.completed with status 'failed':
→ PaymentLog updated to status 'failed'
→ No Subscription is created or updated; access remains unchanged
```

---

## 4. The Data Model

The data model is defined in [`prisma/schema.prisma`](file:///c:/Users/HP/Desktop/Eccelesia/prisma/schema.prisma) and managed through Prisma migrations.

```mermaid
erDiagram
    User ||--o| Subscription : "has"
    User ||--o{ PaymentLog : "logs"
    User ||--o{ Session : "sessions"
    User ||--o{ EmailVerification : "verifications"
    Subscription ||--o{ PaymentLog : "associated payments"

    User {
        String id PK
        String firstName
        String middleName
        String lastName
        String email UK
        String password
        Boolean emailVerified
        DateTime createdAt
    }

    Subscription {
        String id PK
        String userId UK, FK
        Int flwPlanId
        Int flwSubscriptionId
        String planSlug
        Int amount
        String currency
        String status
        String flwCustomerEmail
        DateTime currentPeriodStart
        DateTime currentPeriodEnd
        DateTime canceledAt
        String cancelReason
        DateTime createdAt
        DateTime updatedAt
    }

    PaymentLog {
        String id PK
        String userId FK
        String subscriptionId FK
        String txRef UK
        Int flwTxId
        Int amount
        String currency
        String planSlug
        String status
        String source
        DateTime createdAt
    }
```

### Model Breakdown

#### 1. `User`
Represents the registered user account.
* `id` (`String`, `@id`, `@default(cuid())`): Unique identifier.
* `firstName`, `middleName`, `lastName` (`String`, `middleName` optional): User's legal names.
* `email` (`String`, `@unique`): Login email address.
* `password` (`String`): Bcrypt-hashed password.
* `emailVerified` (`Boolean`, `@default(false)`): Email verification status.
* `createdAt` (`DateTime`, `@default(now())`): Account creation timestamp.
* **Relations**: `subscription` (`Subscription?`), `paymentLogs` (`PaymentLog[]`), `sessions` (`Session[]`), `emailVerifications` (`EmailVerification[]`).

#### 2. `Subscription`
Represents the user's active or previous subscription state (one per user).
* `id` (`String`, `@id`, `@default(cuid())`): Unique subscription record ID.
* `userId` (`String`, `@unique`): Foreign key to `User.id` (1-to-1 relation, `onDelete: Cascade`).
* `flwPlanId` (`Int`): Flutterwave payment plan ID (e.g. `243521` for Monthly, `243522` for Yearly).
* `flwSubscriptionId` (`Int?`): Provider-side subscription ID returned by Flutterwave for recurring tracking.
* `planSlug` (`String`): `"monthly"` or `"yearly"`.
* `amount` (`Int`): Major currency units (e.g., `10000` for ₦10,000).
* `currency` (`String`, `@default("NGN")`): Currency code.
* `status` (`String`, `@default("active")`): Subscription status (`"active"` or `"canceled"`).
* `flwCustomerEmail` (`String`): Email address associated with the provider subscription.
* `currentPeriodStart` (`DateTime?`): Start of the current billing/access period.
* `currentPeriodEnd` (`DateTime?`): End timestamp of paid access.
* `canceledAt` (`DateTime?`): Timestamp when the user requested cancellation.
* `cancelReason` (`String?`): Optional cancellation feedback reason (added in migration `20260922100000_add_cancel_reason`).
* `createdAt` (`DateTime`), `updatedAt` (`DateTime`): Lifecycle timestamps.
* **Relations**: `user` (`User`), `paymentLogs` (`PaymentLog[]`).

#### 3. `PaymentLog`
Unified transaction log for all checkout attempts and recurring payment events.
* `id` (`String`, `@id`, `@default(cuid())`): Unique log entry ID.
* `userId` (`String`): Foreign key to `User.id` (`onDelete: Cascade`).
* `subscriptionId` (`String?`): Optional foreign key to `Subscription.id` (`onDelete: SetNull`).
* `txRef` (`String`, `@unique`): Unique transaction reference (`ECC-<userId.slice(0,12)>-<timestamp>`).
* `flwTxId` (`Int?`): Flutterwave transaction ID returned by the verification API.
* `amount` (`Int`): Amount in whole Naira.
* `currency` (`String`, `@default("NGN")`): Currency code.
* `planSlug` (`String?`): Target plan identifier (`"monthly"` or `"yearly"`).
* `status` (`String`): Transaction state (`"pending"`, `"successful"`, `"failed"`, `"abandoned"`).
* `source` (`String`, `@default("recurring")`): Origin of payment (`"checkout"` or `"recurring"`).
* `createdAt` (`DateTime`, `@default(now())`): Log creation timestamp.
* **Indexes**: `@@index([userId, createdAt])` for efficient audit queries.

#### 4. Historical Schema Evolution
* Migration `20260922090000_collapse_checkout_intent_into_payment_log`: Collapsed the earlier `CheckoutIntent` table into `PaymentLog` by adding the `source` and `status` fields, ensuring a single unified ledger for both in-flight checkouts and final payment records without data loss.
* Migration `20260922100000_add_cancel_reason`: Added the `cancelReason` text field to `Subscription` to store cancellation feedback.

---

## 5. The Concepts

### Flutterwave Verification and Fulfilment
* **Initiation**: Checkout sessions are initiated in [`app/api/checkout/route.ts`](file:///c:/Users/HP/Desktop/Eccelesia/app/api/checkout/route.ts) by calling `createCheckoutSession()` from [`lib/flutterwave.ts`](file:///c:/Users/HP/Desktop/Eccelesia/lib/flutterwave.ts). Flutterwave returns a standard hosted checkout link.
* **Verification**: Payment verification occurs through two complementary mechanisms:
  1. **Webhook Handler** ([`app/api/webhook/route.ts`](file:///c:/Users/HP/Desktop/Eccelesia/app/api/webhook/route.ts)): Processes `charge.completed` events, verifies the `verif-hash` signature, and performs a secondary verification via `verifyCharge()` (`GET /transactions/:id/verify`).
  2. **Direct Confirmation Endpoint** ([`app/api/subscription/confirm/route.ts`](file:///c:/Users/HP/Desktop/Eccelesia/app/api/subscription/confirm/route.ts)): Polled by the checkout return view, verifying the transaction via `verifyTransaction()` or `verifyTransactionByRef()`.
* **Validation Rules**: Before granting access, [`activateSubscriptionFromTransaction()`](file:///c:/Users/HP/Desktop/Eccelesia/lib/subscriptions.ts) validates:
  - `verified.status === "successful"`
  - `verified.currency === log.currency`
  - `Number(verified.amount) === Number(log.amount)`
  - Matching unique `txRef` bound to the user's pending `PaymentLog`.
* **Fulfilment**: Fulfilment is executed in `lib/subscriptions.ts` inside a database transaction (`prisma.$transaction`), which updates `Subscription` fields (`currentPeriodStart`, `currentPeriodEnd`, `status: "active"`) and marks `PaymentLog.status = "successful"`.

### Transaction / PaymentLog Lifecycle
`PaymentLog` acts as an immutable audit ledger:
1. **`pending`**: Inserted immediately when checkout begins (`source: "checkout"`).
2. **`successful`**: Updated upon verified payment confirmation; captures `flwTxId` and links `subscriptionId`.
3. **`failed`**: Updated if the provider transaction failed or verification amount did not match.
4. **`abandoned`**: Marked if a pending checkout is older than 30 minutes or explicitly discarded by the user via `DELETE /api/checkout`.

### Idempotency and Duplicate Webhooks
Duplicate webhook events and duplicate confirmation requests are handled safely:
* **Unique Constraint**: `PaymentLog.txRef` is `@unique` in the database schema.
* **Fulfillment Check**: In `activateSubscriptionFromTransaction()`:
  ```typescript
  if (log.status === "successful" && log.flwTxId) {
    return true;
  }
  ```
  If an event arrives for an already-completed `PaymentLog`, the function exits immediately without modifying subscription periods or billing records.
* **Recurring Charge Idempotency**: In `logPaymentCharge()`, the handler queries `prisma.paymentLog.findUnique({ where: { txRef: params.txRef } })` and returns immediately if a record already exists.

### Webhook Signature Verification
* **Header**: `verif-hash`
* **Secret Source**: `process.env.FLW_SECRET_HASH`
* **Comparison Method**: Constant string comparison (`signature !== secretHash`). If the header is missing or does not match, the route immediately returns HTTP `401 Unauthorized`.
* **Secondary Verification**: The webhook payload data is not trusted blindly; `verifyCharge()` calls Flutterwave's `GET /transactions/:id/verify` endpoint before modifying any records.

### Entitlement
Entitlement represents whether a user currently has access to paid platform features.

#### Explicit Question Answers:

#### 1. Where exactly is entitlement granted?
Entitlement is granted in [`lib/subscriptions.ts`](file:///c:/Users/HP/Desktop/Eccelesia/lib/subscriptions.ts) inside the function `activateSubscriptionFromTransaction()` (lines 130–168) by executing:
```typescript
await tx.subscription.upsert({
  where: { userId: log.userId },
  update: {
    flwPlanId: plan.flwPlanId,
    flwSubscriptionId: flwSubscriptionId ?? existing?.flwSubscriptionId ?? null,
    planSlug: plan.slug,
    amount,
    currency,
    status: "active",
    flwCustomerEmail: log.user.email,
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
    canceledAt: null,
    cancelReason: null,
  },
  ...
});
```
This is called from [`app/api/webhook/route.ts`](file:///c:/Users/HP/Desktop/Eccelesia/app/api/webhook/route.ts) and [`app/api/subscription/confirm/route.ts`](file:///c:/Users/HP/Desktop/Eccelesia/app/api/subscription/confirm/route.ts).

#### 2. What happens if that entitlement path is accessed directly?
If a malicious user or script directly invokes `POST /api/subscription/confirm`:
1. **Rate Limiting**: `rateLimit(request, "confirm")` restricts rapid requests (HTTP 429).
2. **CSRF Validation**: `requireCsrf(request)` blocks requests without a valid `X-CSRF-Token` header (HTTP 403).
3. **Authentication**: `getSessionUser()` ensures the caller has a valid, unexpired session (HTTP 401).
4. **Ownership Verification**: `activateSubscriptionFromTransaction(tx_ref, id, user.id)` checks `if (userId && log.userId !== userId) return false;`. A user cannot confirm someone else's checkout.
5. **Provider Verification**: It queries Flutterwave's API (`verifyTransaction` / `verifyTransactionByRef`). If Flutterwave does not return `status === "successful"` matching the logged amount and currency, the transaction is rejected and access is **not** granted.
*Result*: The entitlement path cannot be abused to gain unauthorized access.

#### 3. How would I prove/dispute a charge from 3 months ago?
To reconstruct and prove a historical charge:
1. Query the `PaymentLog` table for the user's records:
   - `txRef`: The unique reference (`ECC-<userId>-<timestamp>`).
   - `flwTxId`: Flutterwave's integer transaction ID.
   - `amount` & `currency`: Exact amount charged (e.g. `10000` NGN).
   - `status`: Proof of successful completion (`successful`).
   - `createdAt`: Exact timestamp of the transaction.
2. Cross-reference `flwTxId` or `txRef` with Flutterwave via `GET /transactions/:id/verify` or the Flutterwave Merchant Dashboard.
3. Check `Subscription.flwCustomerEmail` and `Subscription.currentPeriodStart`/`currentPeriodEnd` to verify the exact billing period granted for that payment.

#### 4. Actual Proration Arithmetic
The codebase implements a **Period-Preserving Queue Model** (`lib/subscriptions.ts`, lines 119–129):
```typescript
const accessEnd = existing?.currentPeriodEnd ? existing.currentPeriodEnd.getTime() : 0;
const periodStart =
  accessEnd > now.getTime() ? (existing!.currentPeriodEnd as Date) : now;
const periodEnd = addInterval(periodStart, plan.interval);
```
* `Monthly Plan Price`: ₦10,000 (`amount: 10000`, `interval: "monthly"`)
* `Yearly Plan Price`: ₦100,000 (`amount: 100000`, `interval: "yearly"`)

#### 5. Day-12-of-30-Days Example
Suppose a user on a 30-day Monthly plan (started Day 0, expiring Day 30) decides to upgrade/resubscribe to the Yearly plan on Day 12:
1. **Elapsed Days on Monthly Plan**: 12 days.
2. **Remaining Paid Days on Monthly Plan**: $30 - 12 = 18\text{ days}$.
3. **Running `currentPeriodEnd`**: 18 days in the future ($now + 18\text{ days}$).
4. **Target Plan Price Charged**: ₦100,000 (full yearly plan amount).
5. **Period Start Allocation**: Because `accessEnd > now.getTime()`, `periodStart` is set to $now + 18\text{ days}$ (`existing.currentPeriodEnd`).
6. **Period End Allocation**: `periodEnd` is set to $periodStart + 1\text{ year}$.
7. **Total Resulting Paid Access**: 18 days remaining monthly access + 365 days yearly access = **383 continuous days of active access**.
*No pre-paid time is forfeited or discarded.*

#### 6. What happens if Yearly is paid for twice within one minute?
* **Scenario A (Same checkout session replayed/double-webhooked)**:
  The first request sets `PaymentLog.status = "successful"` and stores `flwTxId`. The second request hits `if (log.status === "successful" && log.flwTxId) return true;` in `activateSubscriptionFromTransaction()`, exiting immediately as a no-op without double-extending the subscription period.
* **Scenario B (Two distinct checkouts attempted concurrently)**:
  1. The first checkout creates a pending `PaymentLog`.
  2. A second checkout attempt within 30 minutes triggers the In-Flight Guard in `POST /api/checkout`, returning HTTP 409 `PAYMENT_IN_PROGRESS` and refusing to initialize a second checkout.
  3. Once the first payment completes and becomes active, any subsequent checkout for the same plan triggers Double-Charge Guard #1 in `POST /api/checkout`, rejecting with HTTP 400: `"You are already on the Yearly plan... Starting another subscription would double-charge you."`

### Non-Recurring vs. Recurring Subscriptions
* **Non-Recurring Expiry**: When a subscription is canceled or not renewed, `hasActiveAccess()` evaluates to `false` as soon as `currentPeriodEnd < now`.
* **No `PAST_DUE` State**: The application does not implement a `PAST_DUE` state machine or charge authorization retry loop.
* **Lapse to Free**: Users with lapsed subscriptions seamlessly transition to the Free plan tier (`₦0 / forever`).

### Cancellation at Period End
* When a user cancels at `/dashboard/billing`:
  - `Subscription.status` becomes `"canceled"`.
  - `Subscription.canceledAt` is recorded.
  - `Subscription.cancelReason` captures optional user feedback.
  - Flutterwave's API `PUT /subscriptions/:id/cancel` is called to halt provider recurring charges.
  - `Subscription.currentPeriodEnd` is unchanged.
  - `hasActiveAccess()` continues returning `true` until `currentPeriodEnd` passes.

### Transaction Atomicity
* **Transaction Boundary**: The update of `Subscription` and `PaymentLog` is wrapped in `prisma.$transaction(async (tx) => { ... })`.
* **Rollback Behavior**: If either the `subscription.upsert` or the `paymentLog.update` fails, the entire transaction rolls back, preventing orphaned payment records or unlogged subscriptions.
* **Timeout**: Standard Prisma transaction execution boundaries apply.

### Security and Rate Limiting
* **Rate Limiting**: `lib/rate-limit.ts` enforces an in-memory limit of 30 attempts per 5 minutes per IP address on sensitive endpoints (`checkout`, `confirm`).
* **CSRF Protection**: `lib/csrf.ts` enforces double-submit cookie validation with `X-CSRF-Token` headers on all state-changing API endpoints (`POST`, `DELETE`).
* **Authentication**: All dashboard and checkout endpoints verify session tokens against database `Session` records.
* **Provider Isolation**: `userId` is enforced during direct payment confirmations to prevent cross-user account manipulation.

---

## 6. What Went Wrong

### Problem 1: Sandbox Customer Email Rewriting Breaking Verification Matching
* **1. What went wrong**: Payment confirmations failed intermittently during sandbox testing because customer emails in Flutterwave verification responses did not match the user's database email.
* **2. How it was reproduced**: Running test checkouts on Flutterwave sandbox caused Flutterwave to rewrite customer emails into generated proxies (e.g., `ravesb_<hash>_<original>@gmail.com`).
* **3. Investigation**: Strict equality checks between the API response customer email and the database `user.email` rejected genuine transactions.
* **4. Root cause**: Provider-side email aliasing on test/sandbox checkouts.
* **5. What was changed/fixed**: In [`lib/subscriptions.ts`](file:///c:/Users/HP/Desktop/Eccelesia/lib/subscriptions.ts) (lines 86–90) and `resolveFlwSubscriptionId()`, transaction binding was anchored strictly to the cryptographically unique application `txRef`, and email matching was made tolerant of sandbox proxies.
* **6. How the fix was verified**: Verified by testing checkout confirmations where transactions with rewritten customer emails successfully activated the correct user account.

### Problem 2: Orphaned In-Flight Payment State Across Split Intent Tables
* **1. What went wrong**: In-flight checkout intents were tracked in a separate `CheckoutIntent` table while finalized payments were stored in `PaymentLog`, leading to desynchronization and orphaned records when users abandoned checkouts.
* **2. How it was reproduced**: Initiating a checkout and closing the browser tab left unresolvable rows in `CheckoutIntent` that blocked subsequent checkouts.
* **3. Investigation**: The separation between pre-payment intents and post-payment logs created dual sources of truth.
* **4. Root cause**: Schema architecture separating checkout initialization from transaction auditing.
* **5. What was changed/fixed**: Migration `20260922090000_collapse_checkout_intent_into_payment_log` dropped `CheckoutIntent` and unified all states into `PaymentLog` with a `source` field (`checkout` vs `recurring`) and a 30-minute pending expiration window, alongside an explicit `DELETE /api/checkout` reset action.
* **6. How the fix was verified**: Verified through migration application and testing the `DELETE /api/checkout` endpoint and 30-minute pending checkout auto-abandonment.

### Problem 3: Period Collapse on Plan Re-subscription / Switching
* **1. What went wrong**: When a user who had cancelled their subscription attempted to resubscribe or change plans before their original period expired, resetting `currentPeriodStart = now` immediately overwrote the remaining paid days.
* **2. How it was reproduced**: Subscribing to Monthly, immediately cancelling, and then purchasing Yearly on Day 2 resulted in the remaining 28 days of Monthly access being wiped out.
* **3. Investigation**: The activation logic calculated `currentPeriodEnd` strictly from `now` rather than evaluating whether paid time was still active.
* **4. Root cause**: Lack of period queuing logic for active cancelled subscriptions.
* **5. What was changed/fixed**: Implemented period queueing in `activateSubscriptionFromTransaction()` in `lib/subscriptions.ts` (lines 119–129) where `periodStart` anchors to `existing.currentPeriodEnd` when in the future, combined with a user confirmation prompt (`PLAN_QUEUE_CONFIRMATION_REQUIRED`) in `SubscribeButton.tsx`.
* **6. How the fix was verified**: Verified by asserting that resubscribing with an active period appends the new interval directly to the existing `currentPeriodEnd`.

---

## 7. What This Slice Does Not Handle

### Explicitly Excluded / Unimplemented Features
* **Paystack Gateway Integration**: The implementation exclusively integrates Flutterwave v3; Paystack endpoints or SDKs are not present.
* **Proration Cash Refunds / Discounts**: The implementation uses a period-queuing model; it does not calculate monetary refunds or partial-month price deductions.
* **Invoice & PDF Receipt Generation**: No downloadable invoices or PDF billing receipts are generated.
* **Multi-Currency Support**: Charges and plans are fixed to Nigerian Naira (`NGN`).
* **`PAST_DUE` Retry State Machine**: No in-app grace period or automated charge retry state machine exists; unpaid plans lapse to Free at `currentPeriodEnd`.
* **Distributed Rate Limiting**: Rate limiting in `lib/rate-limit.ts` uses an in-memory `Map`, which is local to a single Node.js process and not shared across serverless/clustered instances.
* **Automated Test Suite**: No automated unit or integration tests exist in the repository.

---

## 8. If I Built This Again

Grounded in the real challenges and lessons from this implementation:

1. **Unified Transaction Ledger from Day One**: Start with a single `PaymentLog` model rather than splitting into separate intent and log tables, avoiding schema migrations to collapse them later.
2. **Provider-Agnostic Payment Adapter**: Wrap payment gateway interactions (Flutterwave, Paystack, Stripe) behind a common interface (e.g. `PaymentGatewayProvider`) to simplify swapping or adding providers without rewriting route handlers.
3. **Distributed Rate Limiter & Session Store**: Replace in-memory rate limiting and process-bound maps with Redis/Upstash KV to ensure consistent rate limiting and session management across multi-region serverless deployments.
4. **Dedicated Webhook Event Ledger**: Maintain a separate `WebhookEvent` table storing raw event payloads, delivery headers, and processing statuses for auditing and replaying failed webhooks.
5. **Comprehensive Mocked Test Suite**: Implement integration tests with mocked payment provider webhooks to automatically verify idempotency, plan queuing, and signature verification before deployment.

---

## Assessment Evidence & Screenshots

* No matching screenshot was found in `screenshots/` (the directory does not exist in the repository).
