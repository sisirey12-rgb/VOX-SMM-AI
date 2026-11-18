# Vox Nexus — Vercel backend

A clean-room, Vercel-ready implementation based on the public Argon panel behavior observed with REA. It includes Supabase email/password authentication, a Postgres schema, an authenticated service-request workflow, wallet ledger, support tickets, admin tools, and a compact responsive frontend.

This is **not Argon's private source code**. The original server handlers, provider credentials, and database were not exposed. This project does not include their secrets or claim to reproduce their server internals.

## Fulfillment and payments

The deployable build uses **manual fulfillment** for legitimate creative and marketing services (content planning, editing, writing, and audits). It does not automate social follows, likes, views, comments, or other engagement metrics. Provider synchronization and online payments are disabled until an operator integrates an authorized, platform-compliant provider and a verified payment processor. The sample provider registry contains only a manual queue.

New accounts start with a zero balance. An administrator can make a wallet adjustment with an audit entry. Requests are created atomically with a wallet debit and an idempotency key; if the balance is too low, the database transaction rolls back.

## Stack

- Vercel Node.js Functions under `api/`
- Supabase Auth and Postgres
- Service-role database access remains server-side
- Static browser client in `public/`

The package targets Node.js 26 and the Vercel CLI 65.8 or newer.

## Setup

1. Create a Supabase project. In **Authentication → URL Configuration**, add your Vercel deployment URL and local development URL (`http://localhost:3000`). Enable email and password sign-in. If email confirmation is enabled, users must confirm before they can sign in.
2. Run [`supabase/migrations/001_vox_nexus.sql`](supabase/migrations/001_vox_nexus.sql) in the Supabase SQL editor, or apply it with the Supabase CLI.
3. Copy `.env.example` to `.env.local` for local work. Add the same variables in Vercel Project → Settings → Environment Variables:

   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY` (or publishable key compatible with the Auth API)
   - `SUPABASE_SERVICE_ROLE_KEY` (**server only; never expose this in browser variables**)
   - `CRON_SECRET` (long random value; protects the dormant scheduled-dispatch endpoint)

4. Deploy the project root to Vercel. For local preview, install dependencies and run `npm run dev` with the Vercel CLI.
5. Create your first user through the sign-up form. Promote that user to administrator in the Supabase SQL editor:

   ```sql
   update public.profiles p
   set role = 'admin'
   from auth.users u
   where p.id = u.id and lower(u.email) = lower('admin@example.com');
   ```

6. To let the administrator try the request flow, add a starting balance using the admin API after sign-in, or through the SQL editor. Example for a test account (amount is cents):

   ```sql
   update public.wallet_accounts w
   set balance_cents = 5000, updated_at = now()
   from auth.users u
   where w.user_id = u.id and lower(u.email) = lower('admin@example.com');

   insert into public.wallet_ledger(user_id,entry_type,amount_cents,description,idempotency_key)
   select id,'admin_adjustment',5000,'Initial test credit','seed:initial-test-credit'
   from auth.users where lower(email)=lower('admin@example.com')
   on conflict (user_id,idempotency_key) do nothing;
   ```

   This SQL shortcut is for setup only. For ordinary adjustments, use the admin API so the wallet and audit ledger are updated together.

## API

| Route | Access | Behavior |
| --- | --- | --- |
| `GET /api/health` | Public | Database readiness and fulfillment mode |
| `GET /api/services` | Public | Active service menu |
| `POST /api/auth/signup` | Public | Creates a Supabase Auth account |
| `POST /api/auth/login` | Public | Password sign-in |
| `POST /api/auth/refresh` | Public | Refreshes a Supabase session |
| `POST /api/auth/logout` | Signed-in | Revokes the current session |
| `GET /api/auth/me` | Signed-in | Current profile and role |
| `GET, POST /api/orders` | Signed-in | List owned requests; create an idempotent request |
| `GET /api/orders/:id` | Signed-in | Read an owned request |
| `GET /api/wallet/balance` | Signed-in | Balance and recent ledger |
| `GET, POST /api/support/tickets` | Signed-in | List or open a ticket |
| `GET /api/providers` | Admin | List provider metadata; no credentials are returned |
| `POST /api/providers/sync` | Admin | Disabled response; no upstream call is made |
| `GET /api/admin/users` | Admin | User and wallet overview |
| `POST /api/admin/users/wallet-adjust` | Admin | Atomic, audited wallet adjustment |
| `GET /api/admin/orders` | Admin | Recent requests |
| `POST /api/admin/orders/status` | Admin | Update a request status and record an event |
| `GET, POST, PATCH /api/admin/services` | Admin | List, add, or update services |
| `GET /api/admin/payment-settings` | Admin | Reports that payments are disabled |
| `POST /api/admin/payment-settings/test` | Admin | Disabled response |
| `GET /api/wallet/public-config` | Public | Deposit availability (disabled) |
| `POST /api/wallet/verify-fampay` | Public | Disabled response; does not verify or accept payments |
| `GET /api/system/maintenance` | Public | Maintenance status |
| `POST /api/cron/dispatch` | `CRON_SECRET` only | No-op status; no automatic fulfillment is performed |

Signed-in API requests use `Authorization: Bearer <access_token>`. The static browser stores session tokens in tab-scoped `sessionStorage`, not in a persistent cookie. API responses use `Cache-Control: no-store`; user-owned queries are filtered by authenticated user ID, and admin routes check the server-side profile role.

## Security notes

- Never put `SUPABASE_SERVICE_ROLE_KEY` in `public/`, client-side code, Git, or any `NEXT_PUBLIC_*` variable.
- Database RLS is enabled. Direct client writes to balances, orders, roles, and provider records are not granted.
- The order-creation and wallet-adjustment RPC functions are executable only by the service role and use row locks plus idempotency keys.
- Promote admins only from a trusted Supabase SQL session. The browser cannot update its own role.
- Enable Supabase Auth protections and Vercel Firewall/rate limiting before public launch. The in-memory API layer does not implement a durable rate limiter.
- No API keys for any upstream service are included. A real integration needs its own permission review, secret storage, error handling, and provider-specific contract.

## Project layout

- `api/` — Vercel Functions and shared auth/database helpers
- `public/` — browser interface
- `supabase/migrations/` — schema, row-level security, triggers, and RPC functions
- `.env.example` — required environment variable names only
