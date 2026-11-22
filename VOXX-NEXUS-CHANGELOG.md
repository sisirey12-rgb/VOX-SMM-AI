# VOXX NEXUS frontend changelog

## Workspace and customer experience

- **src/main.tsx** adds collapsible navigation, breadcrumbs, page search, the account dialog, notifications shortcut, and overview cards.
- **src/ultra-glass.css** adds dark and light theme tokens, responsive layouts, status styling, accessible focus and reduced-motion rules.
- **src/UltraGlass.tsx** provides shared status, loading, dialog, and navigation search components.
- **src/OverviewMetrics.tsx** displays order counts, active campaigns and the current-mode wallet from existing Supabase and payment endpoints.
- **src/Services.tsx** improves catalogue filters, service cards and loading feedback.
- **src/Pacing.tsx** frames the existing Smart Scheduler controls and recommendations.
- **src/Orders.tsx** adds loading and state indicators without changing order actions or polling.
- **src/ProgressGraph.tsx** shows requested, submitted, verified and remaining quantities alongside the existing graph and recorded event timeline.
- **src/RecordTable.tsx** provides filtering and sorting for loaded records and a read-only record detail dialog.
- **src/Workspace.tsx** applies that table to existing administrative, financial, customer and support views.
- **src/PartnerAdmin.tsx** adds readable reseller key status and a revocation confirmation dialog.
- **tests/smart-ui.mjs** exercises signed-in booking and progress, the new shell, and existing workspace navigation with fixture data.

## Scope and verification

Page search covers pages available to the signed-in role. Table search and sorting apply to the records already loaded by the existing query. Provider, payment, scheduler, worker, database, and authentication contracts were left intact.

The browser checks use fixtures. Production sign-in, real payment settlement, provider actions, and live administrator writes require separate testing after deployment.

Verified locally with the production Vite build, TypeScript checks, 10 automated tests, catalogue navigation at 390 and 1440 pixels, and fixture browser checks across 21 admin and 12 customer and reseller pages. The browser suite exercised campaign booking, order progress polling, and read-only record dialogs.
