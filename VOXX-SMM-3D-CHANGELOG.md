# VOXX SMM 3D Ultra Glass changelog

## Changed files

- **src/Landing.tsx, src/landing.css** position VOXX SMM around the existing Smart Drip-Feed scheduler and verified tracking. They add live catalogue categories, support and reseller entry points, layered glass, pointer tilt, and CSS particle effects. Mobile and reduced-motion settings limit animation.
- **src/main.tsx** adds dashboard shortcuts and the notification center, resets workspace selection on account changes, and routes successful Google callbacks to the dashboard. Recovery continues to open the account screen.
- **src/Account.tsx, src/AccountProfile.tsx** add password visibility and profile, security, wallet, and provider details. Display name edits use the existing owner-only policy. Admin visibility requires the existing Supabase authorization RPC for the current session.
- **src/OverviewMetrics.tsx** shares the existing wallet balance lookup with the account profile.
- **src/NotificationCenter.tsx, src/UltraGlass.tsx, src/ultra-glass.css** add a bounded native dialog, recent announcements, device-local unread tracking, and shared visual treatments.
- **src/RecordTable.tsx, src/Workspace.tsx** present the stored support request and its recorded reply. The ticket schema has no attachment field or multi-reply history.
- **index.html, public/brand, public/favicon assets, public/apple-touch-icon.png** update the VOXX SMM wordmark, browser icons, canonical URL, and Open Graph and Twitter previews. The canonical host is www.voxx.in, which is where voxx.in redirects.
- **tests/ui.mjs, tests/smart-ui.mjs** verify the landing, account, notification, and existing campaign and workspace paths against local or fixture data.

## Google and production checks

VOXX starts the existing Supabase Google OAuth flow. A production authorization probe redirected to accounts.google.com. A real account consent and callback test still needs to be completed.

In Google Auth Platform, verify the OAuth client is a Web application and its Authorized redirect URI is https://isgxbsigjbtnuvusijuc.supabase.co/auth/v1/callback. If the Google app is in Testing mode, include the test account in the Audience test-user list. In Supabase Authentication, verify Google is enabled with the matching credentials. Set the Site URL to https://www.voxx.in and allow https://www.voxx.in/?account=google and https://www.voxx.in/?account=recovery. After deployment, test Google sign-in, password sign-in, recovery, and the existing administrator MFA flow with real accounts.

The public headline and social image describe the implemented scheduler and omit an unverified AI claim. The requested wording is available as a separate review concept. Notification read markers are per browser because the existing announcements table has no read-receipt storage.

No API, authorization policy, database migration, order scheduling, provider, worker, or settlement code is part of this upgrade. The separately pending settings migration is outside this delivery. Confirm the new social image is served over HTTPS after publishing.
