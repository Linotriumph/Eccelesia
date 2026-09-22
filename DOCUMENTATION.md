# Authentication Slice — Documentation

---

## 1. What This Is

This is a full-stack authentication slice built with **Next.js 16** (App Router), **PostgreSQL**, **Prisma**, and **bcrypt**. It provides account creation, sign-in, sign-out, email verification, and password reset. Registration creates a session immediately and dispatches a 6-digit verification code by email; the user enters that code in their dashboard to mark the account verified. Sign-in reuses or refreshes an existing database session. Password reset is handled on the same single-page auth form by asking for the user's email and new password directly — no token link is sent; instead the API looks up the account by email and replaces the hash. Every mutating API route is protected by a double-submit CSRF token and an in-process IP-based rate limiter. The protected dashboard is guarded at the server-component layout level: `app/dashboard/layout.tsx` calls `getSessionUser()` and redirects unauthenticated visitors to `/` before any child component renders.

This slice deliberately excludes OAuth/social login, two-factor authentication, and role-based access control — none of these appear in the codebase. The "forgot password" flow does **not** send a reset link by email; the reset form asks for the email address and new password together and updates the hash if the account exists, which means account enumeration is **not** protected on that endpoint. Email verification does not block access to the dashboard; an unverified user can still navigate all dashboard routes — the `VerifyEmailForm` component is rendered conditionally inside the dashboard page as a prompt, not a gate. There are no automated tests in the repository; all test files found are in `node_modules` (third-party library tests) and were not written for this project.

---

## 2. How To Run It

### Prerequisites

1. **Node.js** — No specific version is pinned in `package.json` or `.nvmrc`. The project uses Next.js 16.3.5 and React 19, which require Node.js 18.18 or later. Use the LTS release.
2. **npm** — Included with Node.js. The project uses `package-lock.json`, so `npm` is the intended package manager.
3. **PostgreSQL** — A running PostgreSQL instance is required. The default connection string in `.env.example` targets `localhost:5432`. Any PostgreSQL 14+ version is sufficient.

### Installation

```bash
npm install
```

### Environment Variables

Copy `.env.example` to `.env` and fill in the values.

| Variable | Required | Purpose | Where the value comes from |
|---|---|---|---|
| `DATABASE_URL` | **Required** | Prisma connection string to the PostgreSQL database | Your local or hosted PostgreSQL instance, e.g. `postgresql://user:pass@localhost:5432/dbname` |
| `SMTP_HOST` | **Required** | SMTP server hostname for sending email | Your email provider, e.g. `smtp.gmail.com` |
| `SMTP_PORT` | **Required** | SMTP port | Your email provider — typically `465` (SSL) or `587` (STARTTLS) |
| `SMTP_SECURE` | **Required** | Set to `"true"` if using SSL/TLS (port 465), `"false"` for STARTTLS | Match to `SMTP_PORT` |
| `SMTP_USER` | **Required** | SMTP authentication username (usually the sending email address) | Your email account |
| `SMTP_PASS` | **Required** | SMTP authentication password or app password | Your email provider — for Gmail, generate an App Password |
| `SMTP_FROM` | Optional | The `From` address that appears in outgoing emails; falls back to `SMTP_USER` if not set | Your preference |
| `APP_URL` | Optional | Base URL used to construct password-reset links in emails; defaults to `http://localhost:3000` in development | Your deployment URL in production |
| `FLW_PUBLIC_KEY` | Required for payments only | Flutterwave publishable key (not used by auth routes) | Flutterwave dashboard → Settings → API Keys |
| `FLW_SECRET_KEY` | Required for payments only | Flutterwave secret key (not used by auth routes) | Flutterwave dashboard |
| `FLW_SECRET_HASH` | Required for payments only | Webhook signature secret (not used by auth routes) | Flutterwave dashboard |

> **Note:** `FLW_*` variables are only consumed by the subscription and webhook routes. The authentication slice itself (`/api/register`, `/api/login`, `/api/logout`, `/api/reset-password`, `/api/verify-email`, `/api/csrf`) does not read them. The app will start without them if you are only testing authentication.

### Database Setup

1. Create a database in PostgreSQL:

   ```sql
   CREATE DATABASE slice;
   ```

2. Set `DATABASE_URL` in `.env` to point at that database.

3. Run Prisma migrations to create all tables:

   ```bash
   npx prisma migrate deploy
   ```

   This applies all migrations in `prisma/migrations/` in order.

4. *(Optional)* Seed subscription plan data if testing the billing slice:

   ```bash
   npm run seed-plans
   ```

   This script is at `scripts/seed-plans.ts` and is not required for authentication testing.

### Starting the Application

```bash
npm run dev
```

### Local URL

Open [http://localhost:3000](http://localhost:3000) in a browser.

### Verifying Authentication Works

1. **Sign up** — Go to `http://localhost:3000`, enter a full name (at least two words), a valid email, and a password of 8+ characters. Submit the form. You should be redirected to `/dashboard`.
2. **Check email** — A 6-digit code should arrive at the email address you provided. On the dashboard, enter the code in the verification form.
3. **Sign out** — Click the **Sign out** button. You should be redirected to `/`.
4. **Sign in** — Enter the same email and password. You should reach `/dashboard` again.
5. **Reset password** — On the auth page, click **Forgot password?** to switch to the reset form. Enter the email and a new password. On success the form switches to sign-in with a success message.
6. **Session expiry** — Sessions expire after 7 days. Attempting to reach `/dashboard` after expiry redirects to `/`.

### `.env.example`

A `.env.example` file exists at the repository root. It contains placeholder values for all required variables and must be copied to `.env` before running the project.

---

## 3. The Flow, Step By Step

### Step 1 — Sign Up

#### What the user does
On `http://localhost:3000`, the user selects the **Get started** tab, fills in their full name, email address, and password, and clicks **Sign up**.

#### What the frontend sends
A `POST` request to `/api/register` with JSON body:

```json
{ "name": "Ada Lovelace", "email": "ada@example.com", "password": "S3cur3Pass!" }
```

The CSRF token is read from the `csrf` cookie (via `ensureCsrfToken()` in `lib/csrf-client.ts`) and sent as the `X-CSRF-Token` request header. This happens inside `handleSubmit` in `app/page.tsx`.

Before the request is sent, the client validates the name (letters only, at least 2 words), email format, and password length (≥ 8 characters) inline. These checks mirror the server-side Zod schema.

#### What the server does
Route: `app/api/register/route.ts`

1. **CSRF check** — `requireCsrf()` from `lib/csrf.ts` compares the `X-CSRF-Token` header against the `csrf` cookie value. If they do not match, returns HTTP 403.
2. **Input validation** — `registerSchema` (Zod, in `lib/validation.ts`) validates the body. Name must be letters and spaces only with at least 2 words. Email must be a valid address. Password must be at least 8 characters.
3. **Duplicate check** — `prisma.user.findUnique({ where: { email } })`. If found, returns HTTP 409 with `"An account with that email already exists."`.
4. **Name split** — The full name string is split on whitespace. `firstName` = first word, `lastName` = last word, `middleName` = everything between (or `null` if only two words).
5. **Password hashing** — `hashPassword(password)` from `lib/auth.ts` calls `bcrypt.hash(password, 12)`. Cost factor is 12.
6. **User creation** — `prisma.user.create(...)` inserts the new `User` row with the hashed password and `emailVerified: false`.
7. **Session creation** — `createSession(userId)` from `lib/auth.ts` generates a 32-byte cryptographically random hex token, creates a `Session` row with `expiresAt = now + 7 days`, and sets an HTTP-only `session` cookie.
8. **Verification code** — `createEmailVerification(userId)` from `lib/verification.ts` generates a 6-digit code using `crypto.getRandomValues`, hashes it with bcrypt at cost 12, marks any previous unused codes as used, and stores the new hash in the `EmailVerification` table with `expiresAt = now + 15 minutes`.
9. **Email dispatch** — `sendVerificationCodeEmail(email, code)` from `lib/mail.ts` sends the plain code via nodemailer in the background (`.catch(() => {})` — failure does not fail registration).
10. Returns HTTP 201 with the created user object.

The client receives the response and calls `router.push("/dashboard")`.

---

### Step 2 — Email Verification

#### What the user does
After landing on the dashboard, an unverified user sees a `VerifyEmailForm` inside the **Account** card. They locate the 6-digit code in their email and type it into the input.

#### What the frontend sends
A `POST` request to `/api/verify-email` from `app/dashboard/VerifyEmailForm.tsx`:

```json
{ "code": "482910" }
```

The `X-CSRF-Token` header is included. The input is filtered to digits only and capped at 6 characters client-side.

A separate **Resend code** button (enabled after a 60-second client countdown) sends:

```json
{ "resend": true }
```

#### What the server does
Route: `app/api/verify-email/route.ts`

1. **Rate limit** — `rateLimit(request, "verify")` allows up to 30 requests per IP per 5-minute window.
2. **CSRF check** — `requireCsrf(request)`.
3. **Session check** — `getSessionUser()` from `lib/auth.ts` reads the `session` cookie, looks up the token in the `Session` table, verifies it is not expired. Returns HTTP 401 if no valid session.
4. **Format check** — If `code` is not a 6-digit string, returns HTTP 400.
5. **Verification** — `verifyEmailCode(userId, code)` from `lib/verification.ts`:
   - Marks any time-expired unused codes as `expiredAt = now` first.
   - Looks up the most recent unused, unexpired `EmailVerification` record.
   - If none found, returns the error `"Your verification code has expired. Please request a new one."` — the route then auto-generates and emails a new code.
   - If found, calls `verifyPassword(code, record.codeHash)` (bcrypt compare). If wrong, returns `"That code is incorrect. Please try again."`.
   - On success, runs a Prisma transaction: sets `usedAt = now` and `code = null` on the record, and sets `emailVerified = true` on the `User` row.
6. Returns `{ emailVerified: true }`.

The client calls `router.refresh()` to re-render the server component, which then omits the `VerifyEmailForm` because `user.emailVerified` is now `true`.

**Resend path:** If `resend: true`, `createEmailVerification(userId)` is called (which invalidates prior unused codes), and the new code is emailed.

---

### Step 3 — Sign In

#### What the user does
On `http://localhost:3000`, the user selects **Sign in**, enters their email and password, and clicks **Sign in**.

#### What the frontend sends
A `POST` to `/api/login` from `app/page.tsx`:

```json
{ "email": "ada@example.com", "password": "S3cur3Pass!" }
```

`X-CSRF-Token` header included.

#### What the server does
Route: `app/api/login/route.ts`

1. **Rate limit** — `rateLimit(request, "login")` — 30 requests per IP per 5 minutes.
2. **CSRF check**.
3. **Input validation** — `loginSchema` requires non-empty email and non-empty password.
4. **User lookup** — `prisma.user.findUnique({ where: { email } })`.
5. **Password check** — `verifyPassword(password, user.password)` (bcrypt compare). If user not found **or** password wrong, returns HTTP 401 with `"Invalid email or password."` (same message for both, preventing enumeration at this endpoint).
6. **Session** — `getOrCreateSession(userId)` from `lib/auth.ts`: looks for an existing unexpired session for the user. If found, extends `expiresAt` by 7 days and reuses the same token. If not found, creates a new one. Sets the `session` cookie.
7. Returns the user object.

The client calls `router.push("/dashboard")`.

---

### Step 4 — Accessing the Protected Dashboard

#### What the user does
The user navigates to any URL under `/dashboard`.

#### What the frontend sends
A normal browser navigation request. No explicit API call; the protection is in a server component.

#### What the server does
Layout: `app/dashboard/layout.tsx`

1. Calls `getSessionUser()` from `lib/auth.ts`.
2. `getSessionUser()` reads the `session` cookie, calls `prisma.session.findUnique({ where: { token } })`, and checks `session.expiresAt < new Date()`.
3. If no valid session is found, returns `null`.
4. The layout calls `redirect("/")` if the result is `null`.
5. If the session is valid, the layout renders the sidebar, nav, and child pages.

There is no Next.js `middleware.ts` file in the repository. Protection is entirely handled at the server-component level inside `app/dashboard/layout.tsx`.

---

### Step 5 — Sign Out

#### What the user does
The user clicks the **Sign out** button in the dashboard sidebar.

#### What the frontend sends
A `POST` to `/api/logout` from `app/dashboard/SignOutButton.tsx`:

No JSON body. `X-CSRF-Token` header included.

#### What the server does
Route: `app/api/logout/route.ts`

1. **CSRF check**.
2. Reads the `session` cookie value.
3. If a token is present, `prisma.session.deleteMany({ where: { token } })` removes the session row from the database.
4. `cookieStore.delete("session")` clears the cookie.
5. Returns `{ ok: true }`.

The client calls `router.push("/")` and `router.refresh()`.

---

### Step 6 — Password Reset

#### What the user does
On the auth page, the user clicks **Forgot password?** (below the password label on the sign-in form), which switches the form to `"reset"` mode. They enter their email and a new password and click **Reset password**.

#### What the frontend sends
A `POST` to `/api/reset-password` from `app/page.tsx`:

```json
{ "email": "ada@example.com", "password": "NewP@ss99" }
```

`X-CSRF-Token` header included.

#### What the server does
Route: `app/api/reset-password/route.ts`

1. **Rate limit** — `rateLimit(request, "reset")` — 30 requests per IP per 5 minutes.
2. **CSRF check**.
3. **Input validation** — `resetPasswordSchema` requires a valid email and a password of at least 8 characters.
4. **User lookup** — `prisma.user.findUnique({ where: { email } })`. If not found, returns HTTP 404 with `"No account found with that email."` — **this reveals whether an account exists** (no enumeration protection).
5. **Password update** — `prisma.user.update({ data: { password: hashPassword(newPassword) } })`.
6. **Session invalidation** — `prisma.session.deleteMany({ where: { userId: user.id } })` — all existing sessions for the user are deleted.
7. Returns `{ message: "Password updated successfully." }`.

On success the client switches the form back to `"login"` mode and shows the message `"Password updated. You can now sign in."`.

> **Note:** The reset does not require any email-based token or verification. Any visitor who knows a user's email address can change that user's password. This is a significant security gap — see Section 6 and Section 7.

---

## 4. The Data Model

### `User`

```prisma
model User {
  id              String              @id @default(cuid())
  firstName       String
  middleName      String?
  lastName        String
  email           String              @unique
  password        String
  emailVerified   Boolean             @default(false)
  createdAt       DateTime            @default(now())
  sessions        Session[]
  emailVerifications EmailVerification[]
  subscription    Subscription?
  paymentLogs     PaymentLog[]
}
```

Stores one row per registered user. Every authentication decision eventually traces to a `User` record.

| Field | Authentication role |
|---|---|
| `id` | Primary key (cuid); used as `userId` in `Session` and `EmailVerification` |
| `email` | Unique; the identifier used for login and reset lookups |
| `password` | bcrypt hash (cost 12); compared against submitted passwords during login and reset |
| `emailVerified` | Boolean flag set to `true` when the user successfully enters their 6-digit code; `false` by default |
| `firstName`, `middleName`, `lastName` | Derived from the registration name string; `middleName` is nullable |
| `createdAt` | Audit timestamp |

---

### `Session`

```prisma
model Session {
  id        String   @id @default(cuid())
  token     String   @unique
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())
  expiresAt DateTime
}
```

Stores one row per active session. The browser holds the token in a cookie; the server validates it against this table.

| Field | Authentication role |
|---|---|
| `token` | 64-character hex string (32 random bytes); sent as the `session` cookie value |
| `userId` | Foreign key to `User`; identifies who owns this session |
| `expiresAt` | Checked server-side on every request to `getSessionUser()`; expired sessions are not deleted automatically but are treated as invalid |

---

### `EmailVerification`

```prisma
model EmailVerification {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  code      String?
  codeHash  String
  expiresAt DateTime
  usedAt    DateTime?
  expiredAt DateTime?
  createdAt DateTime @default(now())
}
```

Stores one row per issued verification code. Multiple rows per user may exist over time.

| Field | Authentication role |
|---|---|
| `code` | Nullable. The **plaintext** 6-digit code, stored temporarily. It is set to `null` after the code is consumed (`usedAt` is populated). Added in migration `20260915110000`. |
| `codeHash` | bcrypt hash of the code; used for comparison during verification |
| `expiresAt` | 15 minutes after creation; codes past this timestamp are rejected and the record is marked `expiredAt` |
| `usedAt` | Set to the current timestamp when the code is successfully verified; a non-null `usedAt` excludes the record from lookup |
| `expiredAt` | Set by `invalidateExpired()` and the background sweep (`instrumentation.ts`) when `expiresAt` passes without the code being used; records with a non-null `expiredAt` are excluded from lookup |

---

### Schema Constraints That Make Invalid Authentication State Impossible

| Constraint | What it prevents |
|---|---|
| `User.email @unique` | Two accounts with the same email address cannot exist. The registration endpoint checks for duplicates at the application level first, but this constraint is the database's last line of defence against a race condition where two concurrent registrations use the same email. |
| `Session.token @unique` | Two sessions with the same token cannot exist. Since tokens are 32 bytes of cryptographic randomness, collision is astronomically unlikely, but the unique constraint guarantees it at the database level. |
| `Session.userId` foreign key with `onDelete: Cascade` | When a `User` row is deleted, all `Session` rows belonging to that user are automatically deleted. No orphaned sessions can linger for a deleted account. |
| `EmailVerification.userId` foreign key with `onDelete: Cascade` | Same as above — deleting a user removes all their verification records. |
| `User.password NOT NULL` | A user row cannot exist without a password hash. It is impossible to create an account that could be logged into without a hash comparison. |
| `User.emailVerified NOT NULL DEFAULT false` | Every account starts unverified. There is no way to insert a user row without this flag having a value. |
| `Session.expiresAt NOT NULL` | Every session row must have an expiry. The application code checks this field on every session lookup; the non-null constraint ensures the comparison is always valid. |

There are no `CHECK` constraints defined in the schema or migrations.

---

## 5. The Concepts

### Password Hashing

#### What it is
Password hashing is the process of running a password through a one-way mathematical function before storing it. The stored result (the hash) cannot be reversed to recover the original password. When a user logs in, the submitted password is run through the same function and the results are compared, without ever storing or comparing plaintext.

#### Why it is needed
If the database were stolen or leaked, storing plaintext passwords would immediately expose every user's password — and because people reuse passwords, those credentials would work on other services too. Hashing means an attacker who obtains the database still has to crack each password individually with computationally expensive guessing.

#### How I implemented it
bcrypt is used via the `bcrypt` npm package. The cost factor is 12, set as `BCRYPT_COST = 12` in `lib/auth.ts`.

```ts
// lib/auth.ts
const BCRYPT_COST = 12;

export function hashPassword(password: string): Promise<string> {
  return hash(password, BCRYPT_COST);
}

export function verifyPassword(password: string, stored: string): Promise<boolean> {
  return compare(password, stored);
}
```

`hashPassword` is called in `app/api/register/route.ts` (on account creation) and in `app/api/reset-password/route.ts` (on password update). `verifyPassword` is called in `app/api/login/route.ts`.

The same bcrypt functions are reused for verification codes: `createEmailVerification` in `lib/verification.ts` hashes the 6-digit code with `hashPassword(code)` before storing it, and `verifyEmailCode` compares a submitted code with `verifyPassword(code, record.codeHash)`.

#### What I chose against, and why
MD5 and SHA-256 are fast hashing algorithms unsuitable for passwords: an attacker with a GPU can test billions of candidates per second. bcrypt is deliberately slow and includes a configurable cost factor. Argon2 is considered stronger than bcrypt (it adds memory hardness) and is the current Password Hashing Competition winner, but bcrypt at cost 12 is a well-understood and widely supported baseline. No comment in the code explains the choice of bcrypt over Argon2.

---

### Session Management

#### What it is
Session management is the mechanism by which the server remembers that a user has already authenticated. After a successful login, the server creates a session record and gives the browser a token. On every subsequent request the browser sends that token back, and the server uses it to identify the user without requiring them to log in again.

#### Why it is needed
HTTP is stateless. Without sessions, every request to a protected route would require the user to send their credentials, which is impractical and insecure.

#### How I implemented it
Sessions are stored in the `Session` table in PostgreSQL. On registration (`createSession`) and on login (`getOrCreateSession`), the server generates a 32-byte random hex token:

```ts
// lib/auth.ts
const token = Array.from(
  crypto.getRandomValues(new Uint8Array(32)),
  b => b.toString(16).padStart(2, "0")
).join("");
```

The token is stored in the database with `expiresAt = now + 7 days`. On every request to a protected route, `getSessionUser()` reads the cookie, queries the database for the token, and checks `session.expiresAt < new Date()`.

`getOrCreateSession` (used by login) reuses the user's most recent unexpired session and slides the expiry window forward by 7 days rather than always creating a new row.

Logout (`app/api/logout/route.ts`) calls `prisma.session.deleteMany({ where: { token } })` to delete the session row, then clears the cookie.

#### What I chose against, and why
Stateless JWTs are a common alternative. A JWT encodes the user identity in the token itself, signed with a secret; the server does not need a database lookup to verify it. The trade-off is that a JWT cannot be truly invalidated before its expiry date without a blocklist (which reintroduces server-side state). Database-backed sessions allow instant invalidation on logout or password reset, which is what this implementation does. No rationale is documented in code comments, but the behaviour (deleting session rows on logout and reset) is consistent with choosing database sessions specifically to enable revocation.

---

### Secure HTTP-Only Cookies

#### What it is
An HTTP-only cookie is a cookie that the browser refuses to expose to JavaScript. A `Secure` cookie is only transmitted over HTTPS. These two attributes together prevent a client-side script (including injected scripts in an XSS attack) from reading the session token.

#### Why it is needed
If the session cookie were readable by JavaScript, an XSS vulnerability anywhere on the site would let an attacker script steal the token and impersonate the user from another machine.

#### How I implemented it
In `lib/auth.ts`, the cookie is set with:

```ts
cookieStore.set("session", token, {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_DURATION_MS / 1000, // 604800 seconds (7 days)
});
```

- **Name:** `session`
- **`httpOnly: true`** — always set.
- **`secure`** — `true` in production, `false` in development (to allow `http://localhost`).
- **`sameSite: "lax"`** — prevents the cookie from being sent on cross-site requests initiated by third-party pages (e.g., a `<form>` POST from another domain), while allowing it on top-level navigations.
- **`path: "/"`** — scoped to the entire site.
- **`maxAge`** — 604800 seconds, matching the server-side session expiry window of 7 days.

The CSRF cookie (`csrf`) is set with `httpOnly: false` intentionally, because the client-side JavaScript in `lib/csrf-client.ts` needs to read it to include it in the `X-CSRF-Token` header.

#### What I chose against, and why
Storing the session token in `localStorage` is a common but insecure pattern: `localStorage` is always accessible to JavaScript, making any XSS vulnerability immediately session-hijacking. HTTP-only cookies avoid this. `SameSite: "strict"` would be slightly more restrictive than `"lax"` (it prevents the cookie from being sent on any cross-site navigation, including clicking a link from another site), but `"lax"` is the more practical default for most applications and is used here.

---

### CSRF Protection

#### What it is
Cross-Site Request Forgery (CSRF) is an attack where a malicious website tricks a logged-in user's browser into sending a request to the real application. Because the browser automatically attaches cookies to same-origin requests, the request would carry the user's session token. CSRF protection verifies that the request originated from the application's own JavaScript, not from a third-party page.

#### Why it is needed
Without CSRF protection, a user visiting a malicious page while logged in could have requests submitted on their behalf — for example, triggering a logout or password change — without their knowledge.

#### How I implemented it
A double-submit cookie pattern is used. The CSRF token is a 32-byte random hex string generated by `newCsrfToken()` in `lib/csrf.ts` and set as the `csrf` cookie. The cookie is `httpOnly: false` so client-side JavaScript can read it.

```ts
// lib/csrf.ts
export function validateCsrf(request: Request): boolean {
  const headerToken = request.headers.get("x-csrf-token");
  if (!headerToken) return false;
  const cookieToken = getCsrfCookie(request);
  return !!cookieToken && headerToken === cookieToken;
}
```

The `/api/csrf` route issues a fresh token on demand. The client reads the token from the cookie using `readCsrfToken()` in `lib/csrf-client.ts` and falls back to fetching a fresh one from `/api/csrf` if none is present. Every mutating fetch call in the client includes `"X-CSRF-Token": token` in the request headers.

`requireCsrf(request)` is called at the top of every mutating route handler (`/api/register`, `/api/login`, `/api/logout`, `/api/reset-password`, `/api/verify-email`).

#### What I chose against, and why
`SameSite: "strict"` cookies alone are sometimes cited as sufficient CSRF mitigation, but they have browser compatibility nuances and still allow CSRF through same-site subdomains in some cases. The double-submit cookie pattern provides an explicit application-level check that does not depend on browser SameSite enforcement.

---

### Email Verification

#### What it is
Email verification is the process of confirming that the email address a user registered with is one they actually control. After registration, the server sends a code to the email address; the user must enter that code to prove they received it.

#### Why it is needed
Without verification, anyone can register with an email address they do not own. This leads to impersonation, wasted email capacity (users will receive emails addressed to strangers), and inability to use email for account recovery in a way the real owner controls.

#### How I implemented it
After `prisma.user.create(...)` in `app/api/register/route.ts`, `createEmailVerification(userId)` is called. This:

1. Calls `generateVerificationCode()` in `lib/verification.ts`: uses `crypto.getRandomValues` to produce a uniformly distributed 6-digit code (padded to 6 digits).
2. Marks any previous unused codes for the user as `usedAt = now`.
3. Creates a new `EmailVerification` row with both the plaintext `code` and the bcrypt `codeHash`, and `expiresAt = now + 15 minutes`.
4. Returns the plaintext code.

`sendVerificationCodeEmail(email, code)` in `lib/mail.ts` emails the code via nodemailer. The email is sent in the background; failure does not abort registration.

When the user submits the code in `VerifyEmailForm`, the form `POST`s to `/api/verify-email`, which calls `verifyEmailCode(userId, code)` — bcrypt-comparing the submitted code against the stored hash. On success, a Prisma transaction marks the code record as used and sets `User.emailVerified = true`.

Email verification does **not** block access to the dashboard. An unverified user can still use the application; they simply see the verification prompt.

#### What I chose against, and why
Magic links (where the email contains a URL the user clicks) were not implemented. The codebase contains `generateSecureToken()` and `sendPasswordResetEmail()` in `lib/mail.ts`, which suggests the infrastructure for link-based email flows exists, but for verification a code-entry form was chosen instead of a link. No rationale is documented in the code.

---

### Verification Code Generation

#### What it is
The 6-digit verification code must be unpredictable so that an attacker cannot guess it within the 15-minute window.

#### Why it is needed
If the code were generated with `Math.random()`, an attacker who knew the approximate time of registration could narrow the search space significantly. A cryptographically secure source eliminates this predictability.

#### How I implemented it
`generateVerificationCode()` in `lib/verification.ts`:

```ts
export function generateVerificationCode(): string {
  const buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  const value = (buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3];
  return String(Math.abs(value) % 1_000_000).padStart(6, "0");
}
```

`crypto.getRandomValues` is the Web Crypto API, available in Edge and Node.js runtimes. Four random bytes are combined into a 32-bit integer, taken modulo 1,000,000, and zero-padded to 6 digits.

The code is stored both as plaintext (`code` column, nullable) and as a bcrypt hash (`codeHash`). The plaintext is set to `null` when the code is consumed.

#### What I chose against, and why
`Math.random()` is explicitly not a cryptographic RNG and was avoided. A longer code (e.g. 8 digits) would reduce the brute-force surface but would be harder for users to type; 6 digits is the industry-standard length for OTPs (matching TOTP, SMS verification, etc.).

---

### Token and Code Expiration

#### What it is
Expiration limits how long a code or session remains valid. After the expiry window, the credential is no longer accepted.

#### Why it is needed
Without expiration, a verification code intercepted from an email months ago could still be used. Similarly, a session cookie stolen from a device would work indefinitely.

#### How I implemented it
- **Verification codes:** `expiresAt = now + 15 minutes`, set in `lib/verification.ts` (`VERIFICATION_CODE_TTL_MS = 1000 * 60 * 15`). `verifyEmailCode` checks `expiresAt: { gt: new Date() }` in the Prisma query before accepting a code.
- **Sessions:** `expiresAt = now + 7 days`, set in `lib/auth.ts` (`SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 7`). `getSessionUser` checks `session.expiresAt < new Date()` and returns `null` for expired sessions.
- **Expired code sweep:** `instrumentation.ts` registers a `setInterval` that runs `sweepExpiredCodes()` every 60 seconds, marking all globally expired unused codes with `expiredAt = now`. This keeps the database auditable.

#### What I chose against, and why
Sessions could instead use database-level expiry by deleting rows on a schedule. This implementation keeps expired session rows in place and filters them in the query; this means the `Session` table grows indefinitely unless rows are manually cleaned up. No background sweep for sessions was implemented (only for verification codes). The trade-off is that stale session rows accumulate, but the security behaviour is unaffected because `getSessionUser` always checks `expiresAt`.

---

### Password Reset

#### What it is
Password reset allows a user who has forgotten their password to set a new one. The mechanism must verify that the person requesting the reset is the account owner.

#### Why it is needed
Without password reset, a user who forgets their password permanently loses access to their account.

#### How I implemented it
The "Reset password" mode on the auth page (`app/page.tsx`) asks for the user's email and a new password together. `POST /api/reset-password` (`app/api/reset-password/route.ts`) looks up the user by email; if found, it hashes the new password and updates `User.password`, then deletes all `Session` rows for that user (`prisma.session.deleteMany({ where: { userId: user.id } })`).

No email is sent during the reset flow. No token or verification link is involved. Any person who knows a user's email address can change their password. See Section 6 for the problem this created.

#### What I chose against, and why
The standard approach is to email a time-limited, single-use token to the account's email address, then accept the new password only when that token is presented. This verifies that the person performing the reset controls the email inbox. The infrastructure for this (`generateSecureToken()` and `sendPasswordResetEmail()` in `lib/mail.ts`) was written but is not called by the reset route. The reset route instead accepts the new password directly alongside the email address, bypassing the token step.

---

### Session Invalidation on Password Reset

#### What it is
When a password is changed, all existing sessions are invalidated so that anyone who had previously obtained a session (e.g. via a stolen cookie) is immediately signed out.

#### Why it is needed
If sessions survived a password change, an attacker who had cloned a session token could continue acting as the user even after the user has changed their password. Invalidating all sessions closes that window.

#### How I implemented it
At the end of `app/api/reset-password/route.ts`:

```ts
await prisma.session.deleteMany({ where: { userId: user.id } });
```

This deletes every session row for the affected user. All devices are signed out.

#### What I chose against, and why
An alternative is to rotate the session token rather than destroying all sessions, allowing the device performing the reset to remain logged in while invalidating others. This implementation takes the simpler approach of destroying all sessions, requiring the user to sign in again on every device after a reset.

---

### Rate Limiting

#### What it is
Rate limiting restricts how many requests a given client can make to an endpoint within a time window. It limits the speed of automated attacks such as password guessing.

#### Why it is needed
Without rate limiting, an attacker can systematically try thousands of email/password combinations against the login endpoint, or flood the verification endpoint with guesses.

#### How I implemented it
`rateLimit(request, scope)` in `lib/rate-limit.ts` uses an in-process `Map` keyed by `scope:clientIp`. The IP address is read from the `X-Forwarded-For` or `X-Real-IP` header, falling back to `"unknown"`.

- **Window:** 5 minutes (`WINDOW_MS = 5 * 60 * 1000`).
- **Limit:** 30 requests per IP per window (`MAX_ATTEMPTS = 30`).
- **Response when exceeded:** HTTP 429 with `{ error: "Too many attempts. Please try again later." }` and a `Retry-After` header indicating seconds until reset.

Applied to:
- `/api/login` — scope `"login"`
- `/api/reset-password` — scope `"reset"`
- `/api/verify-email` — scope `"verify"`

`/api/register` does **not** have rate limiting applied.

#### What I chose against, and why
The in-process `Map` is lost on every server restart and is not shared between multiple Node.js processes or application instances. In a multi-instance deployment (e.g. behind a load balancer) each instance maintains its own counter, so an attacker could effectively multiply the limit by the number of instances. A Redis-backed or database-backed rate limiter would share state across instances. This simpler approach was chosen, presumably for development speed, but is noted as a production limitation.

---

### Account Enumeration Protection

#### What it is
Account enumeration is when an attacker can determine from an application's responses whether an email address belongs to a registered account. This information makes targeted attacks (e.g. phishing, credential stuffing) more efficient.

#### Why it is needed
If the login page returns "Email not found" for unknown emails and "Wrong password" for known ones, an attacker can compile a list of valid email addresses by testing them against the endpoint.

#### How I implemented it
At the **login** endpoint (`app/api/login/route.ts`), when either the user lookup fails or the password comparison fails, the same error message is returned:

```ts
return NextResponse.json(
  { error: "Invalid email or password." },
  { status: 401 }
);
```

Both the "no such user" and "wrong password" paths return the same HTTP status and message, making it impossible to distinguish them from the response alone.

At the **reset-password** endpoint (`app/api/reset-password/route.ts`), enumeration protection is **not applied**. The endpoint returns HTTP 404 with `"No account found with that email."` when the email is not registered. This is a known gap documented in Section 6.

#### What I chose against, and why
The reset endpoint could return a generic `200 OK` with a message like "If an account with that email exists, it has been updated" regardless of whether the account was found. This was not implemented.

---

### Server-Side Route Protection

#### What it is
Route protection means that unauthenticated users cannot access pages that require authentication, regardless of what URL they navigate to. "Server-side" means the check happens on the server before any HTML is sent to the browser.

#### Why it is needed
Client-side redirects can be bypassed by disabling JavaScript or by manipulating the browser state. A server-side check ensures the protected content is never transmitted to an unauthenticated requester.

#### How I implemented it
`app/dashboard/layout.tsx` is a Next.js async Server Component. It calls `getSessionUser()` before rendering:

```ts
const user = await getSessionUser();
if (!user) redirect("/");
```

`redirect("/")` is a Next.js server function that sends an HTTP redirect response. No dashboard HTML is rendered or transmitted if the session check fails. This layout wraps all routes under `/dashboard/*`, so the protection extends to every sub-route: `/dashboard`, `/dashboard/plans`, `/dashboard/billing`, and `/dashboard/checkout`.

There is **no** `middleware.ts` file in the repository. All protection is via the server-component layout.

#### What I chose against, and why
Next.js `middleware.ts` runs at the edge (before the server component renders) and is often used for route protection in Next.js projects, as it intercepts every matching request with minimal overhead. Using the layout instead means the protection only applies to the `/dashboard` route group and must be manually added to any other protected layout. For this single protected area the layout approach is functionally equivalent, though `middleware.ts` would be more centralised.

---

### Input Validation

#### What it is
Input validation rejects data that does not conform to expected format or constraints before processing it. Server-side validation is authoritative; client-side validation is a usability enhancement.

#### Why it is needed
Without server-side validation, malformed data can reach the database or downstream logic, causing unexpected behaviour or security issues (e.g., an empty password that bypasses the length check).

#### How I implemented it
Zod schemas are defined in `lib/validation.ts`:

- `registerSchema` — requires a name (letters and spaces, ≥ 2 words), a valid lowercased email, and a password ≥ 8 characters.
- `loginSchema` — requires a non-empty email and non-empty password.
- `resetPasswordSchema` — requires a valid lowercased email and a password ≥ 8 characters.

Each route handler calls `schema.safeParse(body ?? {})`. On failure, the first error message is returned as HTTP 400. On the client side, `app/page.tsx` mirrors the name, email, and password rules inline (separate from Zod) and shows per-field errors on blur. The client-side password display shows a checklist of requirements (lowercase, uppercase, number, special character from `#@>^`, minimum length), but the **server-side** validation only enforces a minimum length of 8 characters — it does not enforce character class rules.

#### What I chose against, and why
No meaningful alternative was verified from the repository beyond the choice of Zod over manual validation. The mismatch between the client-side password checklist (which shows character class requirements) and the server-side schema (which only enforces length) is a gap rather than a deliberate alternative design.

---

### Background Expired-Code Sweep

#### What it is
The sweep is a background process that periodically scans the `EmailVerification` table and marks rows whose `expiresAt` has passed as `expiredAt = now`. This distinguishes "code that was never used and has now expired" from "code that has not yet been checked".

#### Why it is needed
Without the sweep, expired rows accumulate indefinitely with only `expiresAt` set but `expiredAt` still null. The query in `verifyEmailCode` correctly excludes them using `expiresAt: { gt: new Date() }`, but the `expiredAt` field exists in the schema and the audit trail is incomplete without it being populated.

#### How I implemented it
`instrumentation.ts` uses Next.js's instrumentation hook (`register()`) to start a `setInterval` in the Node.js runtime. Every 60 seconds it calls `sweepExpiredCodes()` from `lib/verification.ts`, which issues a `prisma.emailVerification.updateMany` that sets `expiredAt = now` for all globally expired, unused codes.

```ts
// instrumentation.ts
const SWEEP_INTERVAL_MS = 60 * 1000;

export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const run = () => { sweepExpiredCodes().catch(() => {}); };
  run();
  const interval = setInterval(run, SWEEP_INTERVAL_MS);
  if (typeof interval.unref === "function") interval.unref();
}
```

`interval.unref()` prevents the timer from keeping the process alive if Next.js decides to shut down.

#### What I chose against, and why
No meaningful alternative was verified from the repository. A database-level trigger or a cron job external to the application are alternatives, but the instrumentation hook approach keeps everything within the application bundle.

---

## 6. What Went Wrong

The repository has no git history (the directory is not a git repository). There are no test files, no commit messages, no PR descriptions, and no comments explicitly describing bugs that were fixed. The migration history does, however, reveal three distinct schema changes that indicate real problems encountered during development.

### Problem 1 — The verification code was initially stored only as a hash, with no plaintext column

#### Symptom
After the `EmailVerification` table was created (migration `20260914123000_email_verification`), there was no `code` column — only `codeHash`. The code had to be sent by email immediately at generation time; there was no way to retrieve the original code later from the database.

#### Investigation
The schema in migration `20260914123000` shows `codeHash TEXT NOT NULL` but no `code` column. Migration `20260915110000_plaintext_verification_code` subsequently adds `ALTER TABLE "EmailVerification" ADD COLUMN "code" TEXT;`. The column name `plaintext_verification_code` in the migration folder name makes the intent explicit.

#### Cause
The initial design stored only the bcrypt hash, as would be done for a password. However, at some point a need arose to access the original plaintext code from the database after it had been generated — most likely for debugging or for the resend flow, or to support the diagnostic script `scripts_check_emailver.cjs`.

#### Fix
Migration `20260915110000` added the nullable `code TEXT` column. `createEmailVerification` in `lib/verification.ts` now stores both `code` (the plaintext) and `codeHash` (the bcrypt hash). When a code is successfully verified, `verifyEmailCode` sets `code: null` in the same transaction that records `usedAt`, so the plaintext is cleared from the database once it has been consumed.

---

### Problem 2 — There was no way to distinguish a code that had expired from a code that was still valid

#### Symptom
The initial `EmailVerification` table had `usedAt` (to mark consumed codes) and `expiresAt` (to mark when they should expire), but no column to record that a code had actually been swept as expired. The `expiredAt` column did not exist until migration `20260915120000_email_verification_expiry`.

#### Investigation
Migration `20260915120000` adds `ALTER TABLE "EmailVerification" ADD COLUMN "expiredAt" TIMESTAMP(3);`. The migration timestamp is one step after the `code` column addition, suggesting these were discovered in close succession. The `sweepExpiredCodes()` function and the `invalidateExpired()` helper in `lib/verification.ts` both rely on this column.

#### Cause
Without `expiredAt`, the only way to identify an expired-but-unused code was to check `expiresAt < now`. This is correct for querying but leaves the row in a state that is ambiguous for audit: did it expire, or was it not yet checked? The `expiredAt` column was added to record the moment the sweep confirmed expiry, giving each code a complete lifecycle (`created → emailed → expired OR used`).

#### Fix
Migration `20260915120000` added `expiredAt TIMESTAMP`. `lib/verification.ts` was then updated to populate it: `invalidateExpired()` sets `expiredAt = now` for expired, unused codes before any new lookup, and `sweepExpiredCodes()` does the same globally on the 60-second background interval.

---

### Problem 3 — The `User` table initially stored the full name as a single `name` column

#### Symptom
Migration `20260913130313_init` created `User` with a single `name TEXT NOT NULL` column. Migration `20260914113000_add_name_parts` replaced this with `firstName`, `middleName`, and `lastName` columns.

#### Investigation
The migration `add_name_parts` includes a backfill step that splits the existing `name` column on whitespace to populate `firstName`, `middleName`, and `lastName` for any already-registered users, then makes `firstName` and `lastName` NOT NULL and drops `name`. The `registerSchema` in `lib/validation.ts` validates that the submitted name contains at least 2 words, matching the constraint that both `firstName` and `lastName` must be present. The dashboard's `app/dashboard/layout.tsx` and `page.tsx` display `user.firstName` and `user.lastName` directly.

#### Cause
The dashboard needed to display the user's name in parts (e.g. "Welcome back, Ada Lovelace" or a sidebar showing the full name). Splitting a stored single-name string at display time is fragile and does not preserve the original parts consistently. Storing the parts separately is more robust and was adopted after the initial schema proved insufficient.

#### Fix
Migration `20260914113000` performed a live in-SQL backfill and schema alteration. `app/api/register/route.ts` splits the submitted name string on whitespace at registration time and stores the parts separately.

---

## 7. What This Slice Does Not Handle

### What breaks or becomes difficult at scale

- **In-process rate limiter** — `lib/rate-limit.ts` stores counters in a Node.js `Map`. This state is lost on restart and is not shared across multiple application instances. In a load-balanced deployment with N instances, each instance applies the 30-request limit independently, giving attackers an effective budget of N × 30 requests per window. A shared store (Redis, a database counter) would be required.
- **Session table growth** — Expired sessions are never deleted. The `Session` table accumulates one row per session per login over the lifetime of the application. No sweep or TTL-based cleanup exists for sessions (only for `EmailVerification` codes). At scale this table grows without bound.
- **Email delivery** — Registration and verification-code delivery use nodemailer with a direct SMTP connection. There is no retry queue, delivery confirmation, or bounce handling. If the SMTP server is unreachable, the code is silently dropped (caught by `.catch(() => {})`). At high volume, a transactional email service (e.g. SendGrid, AWS SES) with queuing would be needed.
- **Verification code query** — `verifyEmailCode` queries by `userId` with no index beyond the one on `userId` created in migration `20260914123000`. At very high code volume per user this could scan many rows, though for typical users this is negligible.

### What would need to be added before real users used it

- **Secure password reset** — The current reset endpoint accepts a new password given only an email address. A real-world deployment requires a time-limited, single-use token sent to the email inbox. The infrastructure (`generateSecureToken()`, `sendPasswordResetEmail()`) exists in `lib/mail.ts` but is not used.
- **Account enumeration protection on reset** — The `/api/reset-password` route discloses whether an email address is registered by returning HTTP 404 for unknown addresses.
- **Rate limiting on registration** — `/api/register` has no rate limit applied, unlike `/api/login`, `/api/reset-password`, and `/api/verify-email`.
- **Email verification as an access gate** — Unverified users have full dashboard access. The `user.emailVerified` field exists and is checked in `app/dashboard/page.tsx` only to show or hide the `VerifyEmailForm`. No route or action checks for verified status before permitting sensitive operations.
- **Secure HTTPS enforcement** — The `secure` cookie flag is conditional on `NODE_ENV === "production"`. A deployment that accidentally runs in development mode would expose session cookies over HTTP.
- **Session cleanup** — No mechanism to delete expired `Session` rows.

### What was outside the brief

OAuth/social login (Google, GitHub, etc.), two-factor authentication, TOTP-based MFA, magic links, account deletion, email change, username support, and role-based access control are not present anywhere in the codebase and are not part of the authentication slice.

### What was left out because of time

Not verified from the repository. The repository has no git history, commit messages, issue tracker, or comments that explicitly state something was deferred due to time. The presence of `generateSecureToken()` and `sendPasswordResetEmail()` in `lib/mail.ts` — which are defined but never called from the reset route — suggests the token-based reset flow was partially built but not wired up, though the reason (time, design change, or something else) cannot be confirmed from the code alone.

---

## 8. If I Built This Again

If I were rebuilding this authentication slice from scratch, the single change I would make is to implement the password reset flow properly: generate a cryptographically secure, single-use token when a reset is requested, store it as a bcrypt hash alongside an expiry timestamp in the database (or reuse the existing `EmailVerification` table with a different code type), email a link containing the raw token to the address on file, and only update the password hash when a `POST` arrives with a valid, unexpired, unused token — then immediately mark it used. The current implementation accepts a new password given nothing more than the email address, which means any person who knows a user's email can change their password silently. The infrastructure to do this correctly (`generateSecureToken()` and `sendPasswordResetEmail()` in `lib/mail.ts`) was already written and simply needed to be connected to the reset route handler; the gap between the existing code and a secure implementation was genuinely small, making the omission the highest-impact thing to fix.
