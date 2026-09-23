# Login and User Management Method

This application uses passwordless email login for a Next.js App Router application. A user enters an approved email address, receives a six-digit one-time code, and exchanges that code for a random session token stored in an HTTP-only cookie.

The approach includes:

- Email allowlisting: only active users already in the database may receive codes.
- Passwordless login: codes expire after 10 minutes and can be used once.
- Database-backed sessions: sessions last 30 days and can be revoked immediately.
- Role-based access: `OWNER`, `LIBRARIAN`, and `VIEW`.
- Server-side authorization for both pages and API routes.
- Same-origin checks on state-changing requests.
- Generic code-request responses to avoid revealing whether an email is registered.

## Technology

- Next.js App Router
- Prisma
- SQLite in this application; the same models work with PostgreSQL
- Nodemailer and any SMTP provider
- Node.js `crypto` for codes, hashes, and session tokens

## Data model

Add these models to `prisma/schema.prisma`:

```prisma
model User {
  id        Int       @id @default(autoincrement())
  email     String    @unique
  role      String    @default("VIEW")
  active    Boolean   @default(true)
  createdAt DateTime  @default(now())
  sessions Session[]
}

model Session {
  tokenHash String   @id
  userId    Int
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  expiresAt DateTime
}

model LoginCode {
  id        Int      @id @default(autoincrement())
  email     String
  hash      String
  attempts  Int      @default(0)
  consumed  Boolean  @default(false)
  createdAt DateTime @default(now())
  expiresAt DateTime

  @@index([email, createdAt])
}
```

Run a Prisma migration after adding the models.

## Environment variables

```dotenv
DATABASE_URL="file:./dev.db"

# The permanent application owner.
OWNER_EMAIL=owner@example.com

# Generate at least 32 random bytes. Never commit the real value.
AUTH_SECRET=

SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
MAIL_FROM="Application Name <login@example.com>"
```

Generate a secret locally:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

## Roles

| Role | Access |
| --- | --- |
| `VIEW` | Read-only pages and API operations |
| `LIBRARIAN` | Read and write operations |
| `OWNER` | Full access, deletion, and user management |

Use role groups in the authentication helper:

```ts
export const READ = ["OWNER", "LIBRARIAN", "VIEW"];
export const WRITE = ["OWNER", "LIBRARIAN"];
export const OWNER = ["OWNER"];
```

The sole Owner comes from `OWNER_EMAIL`. Do not allow the user-management API to assign or remove the Owner role. This prevents an administrator from accidentally removing the last Owner or promoting another account through a client request.

## Core authentication helper

Create a server-only helper such as `src/lib/auth.ts` with these responsibilities:

1. Normalize and validate email addresses.
2. HMAC login codes with `AUTH_SECRET`.
3. SHA-256 hash session tokens before database storage.
4. Read the session cookie and return the current active user.
5. Protect server-rendered pages with redirects.
6. Protect API routes with `401` and `403` responses.
7. Reject state-changing requests whose `Origin` does not match `Host`.

Key constants and hashing methods:

```ts
import { createHash, createHmac } from "node:crypto";

export const SESSION_COOKIE = "app_session";
export const SESSION_SECONDS = 30 * 24 * 60 * 60;

export function normalizeEmail(value: unknown) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ? email
    : "";
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function hashCode(email: string, code: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("Authentication is not configured.");
  }
  return createHmac("sha256", secret)
    .update(`${email}:${code}`)
    .digest("hex");
}
```

The current-user lookup reads the raw token from the HTTP-only cookie, hashes it, finds the matching session, and checks both its expiry and the user's active status. Return only the fields the application needs:

```ts
{ id: user.id, email: user.email, role }
```

Do not store the raw session token in the database. A database leak should not expose immediately usable session cookies.

## Login flow

### 1. Request a code

The client sends:

```http
POST /api/auth/request-code
Content-Type: application/json

{ "email": "user@example.com" }
```

The server:

1. Checks that the request is same-origin.
2. Normalizes the email.
3. Finds an active allowlisted user.
4. Returns the same successful message for known and unknown emails.
5. Enforces one request per minute and no more than five per hour per email.
6. Marks earlier unconsumed codes for that email as consumed.
7. Generates a code with `randomInt(0, 1000000)` and pads it to six digits.
8. Stores only `HMAC-SHA256(email + code)`, with a 10-minute expiry.
9. Sends the plaintext code by SMTP.

Generic response:

```json
{
  "ok": true,
  "message": "If your email has access, a code has been sent."
}
```

If email delivery fails, consume the newly created code so it cannot later be used.

### 2. Verify the code

The client sends:

```http
POST /api/auth/verify
Content-Type: application/json

{
  "email": "user@example.com",
  "code": "123456"
}
```

The server:

1. Validates the email and six-digit format.
2. Requires an active user.
3. Loads the newest unconsumed code.
4. Rejects expired codes and codes with five failed attempts.
5. Atomically increments the attempt count before checking the submitted code.
6. Compares the stored hash with `hashCode(email, submittedCode)`.
7. Marks a matching code as consumed.
8. Generates a 32-byte random session token.
9. Stores only the SHA-256 token hash with a 30-day expiry.
10. Sends the raw token in an HTTP-only cookie.

Cookie settings:

```ts
response.cookies.set(SESSION_COOKIE, token, {
  httpOnly: true,
  secure: requestOrigin.protocol === "https:",
  sameSite: "lax",
  path: "/",
  maxAge: SESSION_SECONDS,
});
```

Production deployments should always use HTTPS, which makes the cookie `Secure`.

### 3. Sign out

`POST /api/auth/logout` hashes the cookie token, deletes its database session, and expires the cookie:

```ts
response.cookies.set(SESSION_COOKIE, "", {
  maxAge: 0,
  path: "/",
});
```

## Email delivery

Create a small server-only mail helper:

```ts
import nodemailer from "nodemailer";

export async function sendLoginCode(email: string, code: string) {
  const port = Number(process.env.SMTP_PORT || 587);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  await transport.sendMail({
    from: process.env.MAIL_FROM,
    to: email,
    subject: "Your login code",
    text: `Your login code is ${code}. It expires in 10 minutes.`,
  });
}
```

## Protecting pages

Use a server-side helper on every protected page:

```ts
export async function requirePage(roles = READ) {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!roles.includes(user.role)) redirect("/");
  return user;
}
```

Examples:

```ts
// Any signed-in user
const user = await requirePage();

// Editors and Owner
await requirePage(WRITE);

// Owner only
await requirePage(OWNER);
```

The login page should redirect an already authenticated user to the application home page.

## Protecting API routes

Authorization must be repeated at the API boundary. Hiding a button is not access control.

```ts
export async function authorize(request: Request, roles = READ) {
  if (!["GET", "HEAD"].includes(request.method) && !sameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  if (!roles.includes(user.role)) {
    return NextResponse.json(
      { error: "You do not have permission for this action." },
      { status: 403 },
    );
  }
  return null;
}
```

At the start of a route handler:

```ts
const denied = await authorize(request, WRITE);
if (denied) return denied;
```

## User management

The Owner-only `/api/users` endpoint supports:

- `GET`: list users and expose the configured Owner as role `OWNER`.
- `POST`: add a user, change `VIEW`/`LIBRARIAN`, enable access, or disable access.

Example update body:

```json
{
  "email": "user@example.com",
  "role": "LIBRARIAN",
  "active": true
}
```

Validate that:

- The email is valid.
- The role is exactly `VIEW` or `LIBRARIAN`.
- `active` is a boolean.
- The email is not `OWNER_EMAIL`.

When disabling a user, use a transaction to revoke access immediately:

```ts
await prisma.$transaction(async (tx) => {
  const user = await tx.user.upsert({
    where: { email },
    create: { email, role, active },
    update: { role, active },
  });

  if (!active) {
    await tx.session.deleteMany({ where: { userId: user.id } });
    await tx.loginCode.updateMany({
      where: { email, consumed: false },
      data: { consumed: true },
    });
  }
});
```

The management screen should let the Owner:

- Add an allowed email.
- Choose View or Librarian access.
- Change a user's role.
- Disable or re-enable access.
- See the Owner as permanent and non-editable.

## Client login screen

The login UI has two states:

1. Email entry with **Email me a code**.
2. Six-digit code entry with **Sign in**, **Change email**, and **Resend code**.

Useful input attributes:

```tsx
<input type="email" autoComplete="email" />
<input
  inputMode="numeric"
  autoComplete="one-time-code"
  pattern="[0-9]{6}"
  maxLength={6}
/>
```

After verification, use a full navigation such as `window.location.assign("/")` so server components and the root layout immediately read the new cookie.

## Security properties to retain

- Keep `AUTH_SECRET` server-side and require at least 32 characters.
- Generate codes and tokens with Node's cryptographic random functions.
- Store code and session hashes, never their plaintext values.
- Expire codes after 10 minutes and sessions after 30 days.
- Consume each code after successful use.
- Limit verification to five attempts per code.
- Rate-limit code requests.
- Use generic responses for unknown or disabled email addresses.
- Check `active` on every authenticated request.
- Delete sessions and consume codes when disabling a user.
- Protect pages and API routes independently.
- Validate `Origin` for state-changing requests.
- Use HTTP-only, SameSite cookies and HTTPS in production.
- Keep Owner identity in server configuration.

## Files in this application

| Purpose | File |
| --- | --- |
| Authentication helpers | `src/lib/auth.ts` |
| Email delivery | `src/lib/email.ts` |
| Request, verify, and logout routes | `src/app/api/auth/[action]/route.ts` |
| Login page | `src/app/login/page.tsx` |
| Login form | `src/app/login/LoginForm.tsx` |
| User-management API | `src/app/api/users/route.ts` |
| User-management page | `src/app/users/page.tsx` |
| User-management interface | `src/components/UserManager.tsx` |
| Signed-in account bar | `src/components/AccountBar.tsx` |
| Database models | `prisma/schema.prisma` |
| Integration test | `tests/auth.integration.cjs` |

## Porting checklist

1. Copy the three Prisma models and migrate the target database.
2. Install and configure Nodemailer or replace the mail function with the target application's provider.
3. Add the environment variables.
4. Adapt `auth.ts` to the target application's Prisma client and cookie name.
5. Add the request-code, verify, and logout actions.
6. Add the two-stage login form.
7. Add page and API authorization checks.
8. Add the Owner-only user-management API and screen.
9. Replace Book Catalog names, URLs, email subject, and role descriptions.
10. Test unknown users, expired codes, failed attempts, expired sessions, disabled users, every role boundary, logout, and cookie flags over HTTPS.
