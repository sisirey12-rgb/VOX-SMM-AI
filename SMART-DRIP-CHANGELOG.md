# VOXX Smart Drip upgrade

## Existing files modified

| File | Change |
| --- | --- |
| src/Services.tsx | Opens the scheduled campaign flow and keeps single orders available. |
| src/Controls.tsx | Adds per-service admin controls, Manual Advanced selection, fixed campaign confirmation graphs and saved plan details. |
| src/Orders.tsx | Groups campaign batches, renders dashboard and detail graphs, polls authorized order records and opens a graph after single-order confirmation. |
| src/main.tsx | Routes a customer or administrator to the full order detail view. |
| server/operations.ts | Records definite provider rejections, flags interrupted submissions for reconciliation and handles reported failure and remainder updates. |
| server/provider.ts | Distinguishes an explicit order rejection from an ambiguous transport or response failure. |
| README.md | Documents upgrade steps, scheduling, rate assumptions and progress metrics. |

## New files

| File | Purpose |
| --- | --- |
| supabase/migrations/202611210016_pacing.sql | Creates pacing policies, recommendation and booking functions, per-batch dispatch spacing and fixed-mode compatibility. |
| supabase/migrations/202611210017_progress.sql | Records deduplicated progress events, initializes historical snapshots and serves permission-filtered timelines. |
| src/Pacing.tsx | Customer quote comparison, custom durations, batch previews and admin policy editing. |
| src/progress.ts | Computes step-series quantities and outcome rates from recorded events. |
| src/ProgressGraph.tsx | Compact and expanded charts, timestamps, quantity totals and confirmation polling. |
| tests/pacing.test.mjs | Exercises quantity conservation, duration constraints, verified capacity, observed throughput, booking replay, dispatch and fixed schedules. |
| tests/progress.test.mjs | Exercises durable timelines, rates, isolation, duplicate snapshots, provider rejection and ambiguous submission outcomes. |
| tests/smart-ui.mjs | Browser test of confirmation, zero progress, polling updates, detail reload and dashboard rendering with fixture responses. |
| SMART-DRIP-CHANGELOG.md | This file inventory and test summary. |

## Verification and rollout

The TypeScript checks, 10 automated test cases, Vite build and guest catalogue checks at 390 and 1440 pixels passed locally. The mobile Smart booking and graph polling test passed against a fixture API. Database tests used embedded PostgreSQL. Hosted Supabase, the Redis worker and live SMMXPERT submissions were outside this verification.

Existing deployments need migrations 016 and 017 in sequence and the updated application code on the web and worker hosts. An existing worker host running the original dispatcher should be redeployed to pick up the updated shared server code. Keep dispatch disabled during rollout. Use Admin → Schedule limits to review eligibility, pacing and fees before enabling live campaigns. Data predating event tracking is displayed from the records available at migration time.
