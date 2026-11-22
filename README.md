# VOXX

VOXX is an editable React/Vite/TypeScript application for reviewing a provider catalogue, quoting campaigns, collecting wallet deposits, fulfilling approved orders, and running reseller storefronts. The Vercel API and persistent worker share the Node provider adapter. Supabase owns identity, authorization, prices, order claims and settlement.

## Run on Windows

Use Node 24 LTS. Open PowerShell in the extracted folder containing package.json.

```powershell
npm.cmd ci
npm.cmd ci --prefix worker
Copy-Item .env.example .env.local
npm.cmd run dev
```

Vite serves the interface and public preview catalogue. Use a Vercel development environment (from this directory, `vercel dev`) or a configured Vercel preview deployment to exercise /api routes. Use separate staging and production databases. Never put a privileged key in a VITE_ variable.

## Supabase

1. Apply every SQL migration in supabase/migrations in filename order. A linked Supabase CLI project can use `supabase db push`. For an existing Phase 1 database, start with the first unapplied migration. The second migration hides legacy live listings for review.
2. Enable email authentication and confirmation. For production, set Site URL to https://voxx.in and add https://voxx.in/?account=recovery as an allowed recovery destination. Use the localhost origin for the development project. Enable TOTP enrollment and verification for accounts using MFA.
3. Set VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL and SUPABASE_SECRET_KEY from the same project. Only the first two go into the browser build. Prefer the new secret key server-side. Use a private project environment file or secret store.
4. Register and confirm your administrator email. Verify the user's UUID in Authentication, then run the following as the database owner. Existing Phase 1 admins migrate to the admin role. The application checks current profiles for all role decisions.

```sql
update public.voxx_profiles set role='super_admin'
where id='REPLACE_WITH_VERIFIED_AUTH_USER_UUID';
```

5. Sign back in. Use Customers to grant roles, assign a pricing tier and link subordinate accounts. The initial owner uses Account to enroll their authenticator. Enrolled privileged users must verify it after sign-in to regain elevated access.

## Catalogue and fulfillment

Set SMMXPERT_API_KEY on Vercel and the worker. Set SMMXPERT_LIVE_ENABLED=true to allow provider reads. The provider endpoint is pinned. Customers only see published retail prices. Review service policy compliance, allowed target, unit basis and pricing before listing a service. Non-default service types may be imported and browsed but have no checkout form in this release. Catalogue rows and displayed capabilities come from the API. Admin Currency sets an explicit rate to INR for non-INR accounts. Changing an exchange rate affects the next import.

Run Admin → Services → Sync live catalogue. Imports use a transaction, preserve overrides, and reject outdated snapshots. A new service, a changed price or a changed service definition requires publication review. A missing provider service is withdrawn. Markup uses service, category and global precedence. A fixed price overrides markup. Apply a discount using a role or named pricing tier and set a global minimum margin percentage. Existing orders retain their price. All retail rates and final charges are calculated using PostgreSQL numeric.

A customer requests an order with a URL and quantity. A database transaction verifies eligibility, range and price and deduplicates retried requests. Releasing an order requires a funded **live** wallet, administrator approval, valid provider configuration and VOXX_ORDER_DISPATCH=true on the executing host. Keep dispatch disabled while testing. The provider charge can differ from the VOXX retail debit. If an upstream submission times out, use order history to reconcile the provider ID or record a confirmed absence. The latter reverses the debit. Refill and cancellation requests check the service capability. A provider cancellation request is not a confirmation.

## Campaign scheduling

For an existing installation, apply migrations `202611210016_pacing.sql` and `202611210017_progress.sql` in that order, then redeploy the web app and persistent worker from the updated source.

In Admin > Schedule limits, add a verified service with provider evidence, minimum/maximum spacing, maximum runs (up to 240) and a one-time campaign fee. Open Configure variable pacing on its card. Set Slow and Medium units per hour, target spacing, minimum/maximum batch quantity, quantity and interval variation percentages, maximum duration and fee per scheduled hour. The enable switch blocks new variable quotes and further variable dispatches while off. New prices apply to new bookings. Review existing campaigns from Admin > Campaigns to approve, pause, resume or cancel.

In New Campaign choose a live Default service and Scheduled campaign. Enter the total quantity to compare Slow and Medium. Suggested duration in minutes is total units times 60 divided by target units per hour, rounded up and extended to meet batch constraints if necessary. Customers can choose an exact duration in minutes, hours or days. VOXX displays the closest preset for a custom duration, the average pace, rate per 1,000, service subtotal, scheduling fee and final INR total. Expand the preview to see each batch size, charge and minute offset. Infeasible durations are rejected. The hourly charge uses the quoted duration from first to last submission. Provider completion times and worker delays do not increase it.

The database divides units and time independently within the configured variation bounds (rounded to whole units/minutes), provider quantity limits and verified interval limits. Each plan seed reproduces its exact preview at booking. Quantities sum to the requested total and the final offset equals the selected duration. Booking checks the entire quote again and stores the accepted plan. An interruption may extend the actual submission window: the worker enforces each batch's own minimum spacing after the previous submission. Approval, wallet funding and provider fulfillment can also affect timing.

Previously created fixed-interval campaigns keep their existing schedules. Verified multi-run services start in Smart mode. Manual Advanced retains fixed scheduling within service limits. Only enable independently submitted batches after confirming repeat orders to the same target, the billing basis and provider restrictions. Native provider drip-feed parameters are unused.

### Verified progress

Customer and admin order cards, confirmations and full order detail links read persisted database events. Open an order with `?order=ORDER_OR_CAMPAIGN_UUID`. The UI polls Supabase every ten seconds. Viewing a graph never requests a provider status check. Historical orders start with their recorded creation time and use the available dispatch and latest stored status timestamps. A provider order ID establishes acceptance and successful submission together. The graph increases fulfilled units only on verified provider reports. Timeouts stay uncertain until reconciled. Repeated snapshots do not create progress. Pending, uncertain and locally cancelled batches are excluded from acceptance-rate calculations. The confirmed completion rate divides fully completed batches by accepted batches with a terminal outcome. Quantity fulfillment divides verified delivered units by the requested total.

Administrators may enter a verified provider capacity ceiling when available. Smart recommendations also consider median observed throughput from up to 32 recently completed batches for that service when at least three verified timing samples exist in the last 30 days. Missing capacity and timing samples leave the service limits in control. Actual provider completion times may differ from the planned submission window.

## Razorpay

Start with Razorpay test keys. Configure RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and a separate RAZORPAY_WEBHOOK_SECRET on Vercel. Configure https://voxx.in/api/payment?webhook=1 for payment.captured, payment.failed and refund.processed in the matching mode. Use your preview URL for staging. Checkout creates an order server-side in paise. Signed captures credit the ledger once. Refunds create reversing entries. Payments → Check gateway payment reconciles the signed-in owner's gateway order if a capture notification was delayed.

Keep RAZORPAY_LIVE_APPROVED=false during staging. Live keys additionally require explicit merchant and business-category approval and the live flag. Test funds never pay for provider orders. Customer wallets are debited only when a provider submission is claimed. Provider-side partial delivery or cancellation can be settled in Admin → Orders with a single reviewed wallet credit capped at the original debit. No inter-reseller commission percentage or payout cycle is assumed.

## Resellers

Assign the reseller role and optionally a parent reseller. From Reseller, create a store name, slug and colour. Share https://voxx.in/?store=YOUR-SLUG. A signed-in eligible customer can join once. My customers lists directly owned accounts. Hosted stores use the primary domain. Customers retain their own wallets. Orders placed by a reseller API key belong to the issuing reseller and use that reseller's prices and wallet.

Create a key in Reseller and copy the secret once. The database stores only its SHA-256 digest. The issuer and administrators can revoke access. Each key is limited to 60 requests per minute. Send `Authorization: Bearer YOUR_RESELLER_KEY`.

| Method | Path | Result |
| --- | --- | --- |
| GET | /api/reseller?services=1 | Published services and the reseller's INR rates |
| GET | /api/reseller | Latest 100 orders owned by this key's reseller |
| POST | /api/reseller | Submit an order request for review |

Example JSON (illustrative service ID and price). Use a fresh UUID for each intended order and reuse it on retry.

```json
{"service":42,"link":"https://example.org/campaign","quantity":100,"request_id":"bbc757f3-769e-4862-bfcd-aaff88405723","total_inr":10}
```

## Hosting

Import the extracted source root into Vercel, select Vite, use Node 24, npm ci, npm run build, and the dist output. Root api/ functions deploy separately from the frontend. In project settings add **voxx.in**. At GoDaddy open the domain's DNS management and enter the exact record type, host and value Vercel displays for the apex. Add a verification TXT record only if Vercel requests one. Confirm valid DNS and an issued HTTPS certificate in Vercel. This archive contains no account-specific DNS value. Confirm auth and payment redirects after the domain resolves.

Deploy the worker separately on a persistent Node host with a persistent Redis instance. From the project root build with `docker build -f worker/Dockerfile -t voxx-worker .` and run with server variables injected by the host. Alternatively run npm ci at the root, npm ci --prefix worker, then npm run worker on Node 24. Set REDIS_URL for Redis (rediss:// for TLS), SUPABASE_URL, SUPABASE_SECRET_KEY, SMMXPERT_API_KEY and the same provider flags. Do not set the provider dispatch flag during staging against a real provider account. Workers sync the catalogue hourly, poll status every five minutes and check due campaigns once a minute. Admin → Worker health shows the latest job heartbeat. BullMQ retains recent successful and failed jobs. An order in Submitting after an interrupted process requires reconciliation.

## Verification

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
node tests/ui.mjs
```

The SQL test runs the migrations in an embedded PostgreSQL engine with fixture Auth roles. It exercises cross-user isolation, pricing, duplicate requests, atomic claims, test/live wallet separation, capture and refund replay, reseller ownership, key revocation, MFA role restrictions and campaign approval/pause/resume. Other tests cover form encoding, API errors, limits and exact-body webhook signatures. The browser test uses installed Chrome and the compiled guest catalogue at 390 and 1440 pixels. It uses offline assets.

Before launch, complete a hosted Supabase signup, email, recovery and authenticator round trip with separate customer and admin accounts. Use a Razorpay **test** payment and replay its signed webhook. Observe a heartbeat and scheduled catalogue import with the deployed Redis worker. Verify the price basis and eligible service types with your own provider account. Review margins, approvals, settlement rules and live domain configuration before allowing actual spending.

Provider reference: https://smmxpert.com/api
Razorpay webhook reference: https://razorpay.com/docs/webhooks/validate-test/
Supabase redirects: https://supabase.com/docs/guides/auth/redirect-urls
