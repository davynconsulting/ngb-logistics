@AGENTS.md

# NGB LOGISTICS: Cargo Tracking PWA

Act as a senior full-stack architect and developer building the NGB LOGISTICS Cargo Tracking Progressive Web App.

The authoritative functional reference is `reference/NGB_LOGISTICS_Cargo_Tracking_Functional_Specification_v1.pdf` (FRS v1.0). The approved technical plan (architecture, schema, sprints) is in `~/.claude/plans/projects-ngb-logistics-gentle-simon.md`.

## Stack
Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · shadcn/ui · Supabase (Postgres, Auth, Storage) · PWA · Vercel. Package manager: **npm**.

## Two experiences, one secure backend
1. **Client portal** (`/portal`): mobile-first. Covers shipment tracking, documents, ETA, invoices, payments and notifications.
2. **Admin platform** (`/admin`): shipment registration, milestones, containers, transport, customs, finance, exceptions and reporting.

## Development principles
- Follow the functional specification. Build incrementally through the five sprints.
- Use reusable components and keep the architecture maintainable.
- Enforce permissions and organization-level isolation **on the server and in the database**. Use Supabase Row Level Security on every table.
- Keep a complete, append-only audit trail for operational events. Corrections append new records and never overwrite.
- Never expose the service-role key or other secrets to frontend code. It lives only in `lib/supabase/admin.ts` (`server-only`) and is never prefixed `NEXT_PUBLIC_`.
- Do money with decimals: `numeric(14,2)` in Postgres, strings plus `decimal.js` in TypeScript (`lib/domain/money.ts`). Never use JS floats. Never mix currencies.
- Validate every shipment status transition, in the database (RPC functions) and not just in the UI.
- Make everything responsive and smartphone-friendly. Avoid horizontal scrolling in primary forms.
- Use realistic but **fictional** test data.
- Phase 1 has no live GPS and no external logistics integrations.

## Working method (for every major feature)
1. Explain what will be built.
2. Identify the database changes.
3. Explain the security implications.
4. Break the work into tasks.
5. Implement.
6. Run the tests and fix errors.
7. Summarize what is done and what remains.

Don't generate the whole app in one go. **Don't make destructive database changes or deploy anything without the user's approval.** Show migration SQL before pushing it to Supabase.

## Project facts and gotchas
- **Supabase:** there is no local Docker. A hosted **dev** project, `ngb-logistics-dev` (ref `idyydcuihxkyitylkugo`), is the only database. Its credentials are in `.env.local` (gitignored). Never print or echo the secret values. Never run `supabase db reset` against it without explicit approval.
- **Next 16:** the request interceptor is `proxy.ts` (middleware is deprecated). Read `node_modules/next/dist/docs/` before using unfamiliar APIs.
- **Cache Components is on:** reading `cookies()` (the session) must happen inside `<Suspense>`. Don't read it at the top level of a layout. `lib/supabase/server.ts` calls `connection()` first, because the Supabase client reads the clock, which Next forbids during prerender.
- **Auth:** `proxy.ts` handles routing only. Pages must call `requireClient()` / `requireStaff()` from `lib/dal/session.ts`, and RLS is the real guard. Never use `getSession()` for trust decisions; use `getClaims()`.
- **Never put tenant data in a server-side `'use cache'` or `'use cache: remote'`**, or one client could see another's data. Use `'use cache: private'` or no caching.
- **Tailwind** loads through `@tailwindcss/turbopack` in `next.config.ts`, not PostCSS.
- **This Mac runs macOS 12.** Playwright's browsers (Chromium, Firefox and WebKit) don't support it, so `npm run test:e2e` can't run locally. Run e2e tests in CI (Linux) instead. Locally, check pages with `next start` + `curl`.
- **Role-blocked and not-found pages return HTTP 200.** `redirect()` and `notFound()` run inside `<Suspense>` after streaming starts, so the status stays 200. The redirect happens in the browser, and the not-found page adds `noindex`. Tests should check the page content (no protected data, "could not be found") rather than the status code.
- **Money and other `numeric` columns:** send the validated decimal *string* to Supabase, never `Number(...)`. The generated types say `number`, so cast with `as unknown as number` and leave a comment.
- **New shipments are registered only through the `register_shipment` RPC** (one transaction, starts as draft). Duplicate BLs (case-insensitive) and containers already on an open shipment are rejected in the database.
- **Users can't set `organizations.is_internal`** (it isn't in the column grants), and an insert that includes it fails with "permission denied".
- **Documents:** files go straight from the browser to the private `shipment-documents` bucket, never through our server, because Vercel caps request bodies at about 4.5 MB.
  - The steps are `prepareDocumentUpload` (the server picks the path and returns a signed upload token, created as the user), then `uploadToSignedUrl` in the browser, then `finalizeDocumentUpload` (the `record_document` RPC).
  - Size and file type always come from `storage.objects.metadata`, set by the `documents_file_facts` trigger.
  - Verify and reject only through the `review_document` RPC.
  - The checklist and `shipments.doc_status` are kept up to date by triggers. Never set them by hand.
  - Downloads go through `/documents/{id}`, which creates a 60-second signed URL as the user.
- **Milestones and statuses (migration 0010):** status columns change only through `record_milestone()` / `correct_milestone()` (server actions in `lib/actions/milestones.ts`).
  - The rules (preconditions, effects, allowed roles) are rows in `milestone_catalogue`. `lib/domain/milestones.ts` mirrors them for UI hints only.
  - `milestone_events` is append-only. A correction or cancellation is a new row. Read through the `milestone_timeline` view, which applies the latest correction.
  - The shipment's overall status is the least-advanced container. Gate-out needs customs released. Out-of-order steps need an ops manager/admin override with a reason.
  - Forms that create the default time or the idempotency key render on the client only (`useSyncExternalStore`), because the server runs in UTC.
- **ETA (0011):** `current_eta` changes only through `revise_eta()`, which needs a reason. Every value is kept in the append-only `eta_revisions`. Materiality (>2 h if due within 24 h, else >6 h) is decided in the database from `app_settings`.
- **Transport (0012):** trucks are assigned only through `assign_transport()`, which records "Truck assigned" via `record_milestone`. Cancel with `cancel_transport_assignment()`. Gate-out needs an active assignment (trigger) and customs release. Driver name/phone live in `driver_contacts`, which clients can never read.
- **Exceptions and SLA (0013):** an exception is a record, not a status (`shipments.has_open_exception` is set by trigger). Change exceptions only through `open_exception`, `update_exception`, `escalate_exception` and `resolve_exception`; every step is logged in `exception_updates`.
  - `private.sla_scan()` runs every 15 minutes (pg_cron job `ngb-sla-scan`). Ops managers can also trigger it with `run_sla_scan()`.
  - Thresholds are in `sla_rules`. Clients have no access to exceptions until the portal view in Sprint 3.
  - `supabase db lint` reports "pg_temp.sla_now does not exist" for `sla_scan`. That's a false positive: the temp table is created at run time.
- **Notifications (0014–0016):** database triggers queue notifications. Never insert into `notifications` or `notification_deliveries` from the app.
  - The rules are in `notification_rules`: one row per template key, deciding push/WhatsApp.
  - `private.enqueue_notification` sends client templates only to users of the shipment's client organization and staff templates only to staff. It deduplicates on (event, recipient, template) (AC-08).
  - Push needs a `push_subscriptions` row. WhatsApp needs opt-in plus a phone number; `consent_at` is stamped by a trigger.
- **Sender:** the `notify-sender` edge function runs shared code in `supabase/functions/_shared/notify/`.
  - The code has no Deno or Node imports, only Web Crypto and fetch. Imports use `.ts` extensions. Next, Vitest and Node scripts import the same files.
  - Web Push is implemented in `webpush.ts` (RFC 8291/8292) and checked against the RFC test vector. Push endpoints must be on known push-service hosts (SSRF guard).
  - WhatsApp is **mock only** in Phase 1 (`WHATSAPP_PROVIDER=mock`; `WHATSAPP_MOCK_MODE=ok|transient|permanent` simulates outages).
  - The database decides retries: backoff 1/5/15/60 min, then failed after 5 attempts or 24 h. Ops managers retry failed deliveries from `/admin/notifications`.
  - pg_cron (`ngb-notify-sender`, every minute) and a statement trigger on new deliveries call the function through pg_net. The URL and secret come from Vault (`notify_sender_url`, `notify_sender_secret`); while they're unset, nothing is sent.
  - Run the sender locally against dev with `npm run notify:run`.
  - `node scripts/gen-notify-keys.mts` adds the VAPID keys and `NOTIFY_SENDER_SECRET` to `.env.local` if they are missing, and prints names only.
  - `tsconfig.json` excludes `supabase/functions/*/index.ts` (Deno entry points). Those are checked by `tsconfig.functions.json` as part of `npm run typecheck`.
- **PWA:** the manifest is `app/manifest.ts` (`start_url` is `/portal`; the proxy sends staff on to `/admin`). Icons come from `node scripts/gen-icons.mts`, and the outputs are committed. The service worker is `public/sw.js`, with offline page `public/offline.html`.
  - The service worker caches **only** the offline page and its icon. Never cache pages or API data there: they hold per-user data, and phones may be shared.
  - Notification links are restricted to same-origin paths.
  - Devices register through `registerPushDevice` → `register_push_subscription()` (0018). A device signed in by a new user moves to that user, with at most 10 devices per user.
  - Sign-out sends the device's endpoint, so its subscription is deleted. The service worker renews rotated subscriptions via `POST /api/push/renew` (same origin only).
  - Only known push-service hosts are accepted (`isAllowedPushEndpoint`).
  - iOS needs "Add to Home Screen" (16.4+) before push works; `PushToggle` explains this.
  - Security headers are set in `next.config.ts`. A full script CSP with nonces is planned for Sprint 5.
- **Client reads (0015):** clients can't read `milestone_events` or `transport_assignments` directly, because they carry internal reasons. Use `client_timeline()`, `client_transport()` and `client_shipment_alerts()`.
  - Driver contact is shown only if `organizations.show_driver_contact` AND `driver_contacts.share_with_client`.
- Forms that submit manually (keeping values on a refusal, converting local times to ISO) use `components/forms/use-form-action.ts`. Don't call `Date.now()` while rendering (lint purity rule): compute time-based flags in the DAL.
- **Testing server actions over HTTP:** POST to the page with a `Next-Action: <id>` header. Get the ID from `.next/server/server-reference-manifest.json`. Encode the arguments with React's `encodeReply` from `next/dist/compiled/react-server-dom-turbopack/client.node.js`. Field order matters when an action takes a FormData, so don't hand-build the encoding.
- **Rendered HTML contains `<!-- -->`** between adjacent text nodes (e.g. `Earlier versions (<!-- -->1<!-- -->)`). Strip these before matching text in tests.
- **Forms** use shadcn's `field` component with react-hook-form + zod, not the older `form` component.

## Commands
- `npm run dev` / `npm run build` / `npm run lint` / `npm run typecheck`
- `npm test` (Vitest unit tests in `tests/unit`)
- `npm run test:e2e`: Playwright, mobile and desktop, in `tests/e2e`.
  - Covers login and routing, shipment registration, document upload/verify/download, milestones, ETA and exceptions.
  - It can't run on this Mac (macOS 12), so run it in CI. It needs `E2E_PASSWORD` (the seeded password) and the `NEXT_PUBLIC_SUPABASE_*` variables.
  - Locally the password is read from `.env.local`.
- `npm run test:db`: applies every migration to an in-memory Postgres (PGlite, no Docker, no network) and checks RLS, grants, RPCs and triggers as each role (`tests/db/rls.check.mjs`).
  - Add a section there for every new migration.
  - This harness stands in for pgTAP, which would need local Docker.
- `npm run test:live`: real flows against the **dev** project and a local production server.
  - First run `npm run build && npx next start -p 3123`.
  - Suites are in `tests/live`: auth/routing, admin flows, documents, milestones, operations (ETA/transport/exceptions), notifications (push via a decrypting fake push service, mock WhatsApp, outage and retry).
  - It calls the real server actions over HTTP and adds fictional test data each run.
  - Supabase allows about 30 sign-ins per 5 minutes per IP, so each user signs in once per run. Don't run it twice back-to-back.
- Migrations live in `supabase/migrations/`. Supabase CLI v3 targets a local database by default, so always pass **`--remote`**:
  - `npx supabase db push --remote --dry-run` (show the dry run to the user first)
  - `npx supabase db push --remote` (only after the user approves)
  - `npx supabase migration list --remote` and `npx supabase db lint --remote --level warning`
- `npm run db:seed` loads fictional dev data (`scripts/seed-dev.mts`). It's re-runnable, only adds, and refuses to run against any project other than the dev one.
  - Test users: `<role>@ngb.example` (e.g. `admin@`, `ops.manager@`, `doc.officer@`, `clearing.agent@`, `transport@`, `driver@`, `finance@`), plus 2 per client (e.g. `aline@akagera.example`, `jean@kivuhardware.example`).
  - All test users share the password `SEED_USER_PASSWORD` from `.env.local`.
- **Users get their role and organization from `app_metadata`** (service role only), which the `private.sync_user_profile` trigger copies to `profiles`. Never trust `user_metadata`, because users can edit it.
- `npm run db:types` regenerates `lib/supabase/database.types.ts` after every migration.
- The CLI is already logged in and linked. Interactive commands (`supabase login`, `link`) must be run by the user in Terminal.app, because the in-chat `!` shell isn't a TTY.
