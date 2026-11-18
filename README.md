# Vox Nexus — Argon-informed Vercel panel

A clean-room Vox Nexus application assembled from the public Argon browser client and observed API route names. It recreates the public page structure and provides Supabase-backed authentication, campaign/mission records, bundle presets, ratio settings, wallet views, support, and admin routes. It is not Argon's private source code or database.

## What is and is not reproduced

- Public pages: landing, sign-in, sign-up, panel, orders, support, ratios, curve studio, tracker, providers, and wallet.
- The browser-observed API families `/api/missions`, `/api/bundles`, `/api/ratios`, `/api/wallet/*`, `/api/providers*`, `/api/support/tickets`, `/api/system/maintenance`, and `/api/admin/*` are represented by server routes.
- Missions are stored with status `awaiting_provider`. The original provider-selection logic and provider API were not exposed, so this project does not dispatch social actions or claim a campaign was delivered.
- Online deposits are disabled. The payment verification route does not accept payment claims or credit a wallet.
- A single Vercel catch-all function dispatches API paths, keeping the project under the Hobby plan's 12-function limit.

## Deploy to Vercel

1. Create a Supabase project and enable email/password authentication.
2. Run `supabase/migrations/001_vox_nexus.sql`, then `supabase/migrations/002_panel_engine.sql` in the Supabase SQL editor.
3. Add these Vercel environment variables:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY` (a Supabase publishable key also works)
   - `SUPABASE_SERVICE_ROLE_KEY` (use the Supabase secret key; server-side only)
   - `CRON_SECRET` (long random value)
4. Add the Vercel deployment URL to Supabase Auth's allowed redirect URLs.
5. Deploy the repository root. The included Vercel CLI command is `npm run deploy`.
6. Create an account, then promote the first administrator in the Supabase SQL editor:

   ```sql
   update public.profiles p
   set role = 'admin'
   from auth.users u
   where p.id = u.id and lower(u.email) = lower('admin@example.com');
   ```

## API surface

| Route | Methods | Access |
| --- | --- | --- |
| `/api/auth/signup`, `/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout`, `/api/auth/me` | POST/GET | Public or signed-in |
| `/api/missions` | GET, POST, PATCH, DELETE | Signed-in; admin can view all |
| `/api/bundles` | GET, PUT | Signed-in |
| `/api/ratios` | GET, POST | Public read; admin write |
| `/api/wallet/balance` | GET | Signed-in |
| `/api/wallet/public-config`, `/api/wallet/verify-fampay` | GET/POST | Payment flow disabled |
| `/api/providers`, `/api/providers/sync` | GET/POST | Admin; sync disabled until a provider is configured |
| `/api/support/tickets` | GET, POST, PATCH | Signed-in |
| `/api/system/maintenance` | GET, PATCH | Public read; admin write |
| `/api/admin/users`, `/api/admin/users/wallet-adjust`, `/api/admin/orders`, `/api/admin/orders/status`, `/api/admin/earnings`, `/api/admin/services`, `/api/admin/payment-settings` | GET/POST/PATCH | Admin |
| `/api/health` | GET | Public |

## Local development

Install dependencies and run `npm run dev`. Configure the Supabase variables in `.env.local` first. `npm run deploy` publishes to Vercel.

## Security

Keep Supabase's secret/service-role key out of `public/`, browser storage, and Git. RLS is enabled; admin endpoints check the server-side profile role. The Vercel function uses server-side Supabase access. Provider API credentials are not included.

## Project layout

- `public/` — responsive Vox Nexus pages and browser integration
- `api/[...route].js` — single Vercel function router
- `server-routes/` — route handlers and shared server helpers
- `supabase/migrations/` — schema, row-level security, and panel tables
