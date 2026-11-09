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
- **Every page renders per request (Sprint 5).** `cacheComponents` is OFF because the nonce CSP needs it: prebuilt shells can't carry a per-request nonce (measured cost ~8 ms first byte). The root layout reads the nonce with `headers()`, which makes every route dynamic. Don't turn Cache Components, partial prerendering or static pages back on without dropping the nonce CSP. The existing `<Suspense>` boundaries around session reads stay (they still stream).
- **CSP:** `proxy.ts` sets it per request from `lib/security/csp.ts` (scripts: nonce + `'strict-dynamic'`, no eval; styles: inline allowed because UI libraries inject `<style>`; `connect-src`, `img-src`, `font-src` self (+ Supabase for connect) only). Next adds the nonce to its scripts; any new inline script must use the nonce from `headers().get("x-nonce")`. New third-party origins (fonts, analytics, WhatsApp widgets) must be added there deliberately. `tests/live/security.mjs` checks every script carries the nonce; `tests/e2e/csp.spec.ts` checks the browser reports no violations (CI).
- **Auth:** `proxy.ts` handles routing only. Pages must call `requireClient()` / `requireStaff()` from `lib/dal/session.ts`, and RLS is the real guard. Never use `getSession()` for trust decisions; use `getClaims()`.
- **Never put tenant data in a server-side cache** (`'use cache'`, `unstable_cache`, fetch caching), or one client could see another's data.
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
  - Security headers are set in `next.config.ts`; the page CSP with nonces comes from `proxy.ts`.
- **Client portal:** pages are `/portal` (overview), `/portal/shipments`, `/portal/shipments/[reference]`, `/portal/notifications` and `/portal/settings`. Data comes from `lib/dal/portal.ts`.
  - List columns explicitly (never `*`), because clients can read every column of their own shipment rows.
  - A reference that doesn't exist and another client's reference give the same "not found".
  - Clients upload only `CLIENT_UPLOAD_TYPES` through the same prepare/finalize actions. Their uploads are always client-visible, pending review, and notify the shipment's ops owner.
  - Inbox texts come from the shared templates (`inboxEntry`). Opening a notification marks it read.
  - WhatsApp consent is set through `saveWhatsApp`; the number must include the country code.
  - Navigation is a bottom bar on phones (`PortalNav`). `usePathname()` stays inside `<Suspense>` and is not used in the Suspense fallback (written for Cache Components; harmless now).
- **ETA reason (0019):** `shipments.eta_reason` is client-readable. A revision hidden from the client sets it to "Schedule updated"; the real reason stays in `eta_revisions`.
- **Client reads (0015):** clients can't read `milestone_events` or `transport_assignments` directly, because they carry internal reasons. Use `client_timeline()`, `client_transport()` and `client_shipment_alerts()`.
  - Driver contact is shown only if `organizations.show_driver_contact` AND `driver_contacts.share_with_client`.
- **Drivers (0020):** drivers use `/driver` only (`homePathFor`, `canUseArea`). `requireStaff()` sends a driver to `/driver` unless "driver" is listed explicitly; driver pages use `requireDriver()`.
  - A driver reaches a shipment only through an ACTIVE `transport_assignments` row with `driver_user_id` = them, and not once the shipment is closed. `shipment_assignments` no longer gives drivers access.
  - A trigger lets drivers record milestones only for containers on their own truck, and never with a client-facing `public_note` (their notes are internal).
  - Drivers are not "office staff" (`private.is_office_staff()`). They can't read other profiles, client organizations, `milestone_events`, internal notes, other trucks, hidden ETA reasons, settings or SLA rules. They read their jobs through `driver_jobs()` / `driver_job_events()`.
  - Driver uploads are always stored with `client_visible = false` (trigger). Drivers see only transport papers and their own uploads.
  - Drivers set their own consent with `set_my_contact_sharing()`. `driver_report_problem()` records a staff-only update and notifies the ops owner and the assigning coordinator (`staff.driver_report`).
  - New staff-only tables must exclude drivers too: use `private.is_office_staff()`, not `private.is_staff()`.
- **Finance (0021):** decisions: tax rate per invoice line; numbers `INV-YYYY-NNNNN` (also `CN-…` credit notes, `RCPT-…` receipts) from `document_sequences` under a row lock, assigned only on issue (gap-free; drafts have no number); the same finance user may record and verify a payment.
  - Write only through the functions: `save_invoice_draft`, `issue_invoice`, `record_payment`, `review_payment` (finance only), `issue_credit_note`, `void_invoice`, `set_invoice_dispute`. No direct table writes for anyone.
  - Totals, `amount_paid`, `amount_credited`, `balance_due`, invoice `status` and `shipments.finance_status` are derived by `private.refresh_invoice` / `refresh_shipment_finance`. Never set them from the app.
  - Only VERIFIED payments count. Recording and crediting are capped at balance minus payments awaiting verification, so the balance can't go negative. Currency of a payment or credit note must equal the invoice currency.
  - Payments, payment reviews and credit notes are append-only; issued invoices and their lines are frozen (trigger). Void only before any payment or credit; otherwise use a credit note.
  - Finance tables are readable by finance, admin and ops manager only (`private.is_finance_reader()`). Clients will read through client-safe functions.
  - UI previews use `lib/domain/finance.ts` (`previewLine`/`previewTotals`), which mirror the database rounding. Amounts are strings end to end.
  - Screens: `/admin/finance` (list, outstanding per currency, never summed across currencies), `/admin/finance/invoices/new` (`?shipment=<id>`), `/admin/finance/invoices/[id]` (draft editor + issue, or payments, verify/reject, credit notes, dispute, void) and `/admin/finance/receipts/[paymentId]` (printable; verified payments only). Reads in `lib/dal/finance.ts` turn PostgREST numbers into 2-decimal strings immediately; actions in `lib/actions/finance.ts`.
  - The draft editor sends its lines as JSON in one `lines` form field. Live tests: `tests/live/finance.mjs`.
- **Client invoices (0022):** clients read finance only through `client_invoices(number?)`, `client_invoice_lines`, `client_invoice_activity` and `client_receipt` (by printed INV-/RCPT- number; own organization only; never drafts; no reasons, staff names, internal notes or rejected payments). Portal pages: `/portal/invoices`, `/portal/invoices/[number]`, `/portal/receipts/[number]`; reads in `lib/dal/client-finance.ts`. Disputed shows as "Under review", void as "Cancelled".
  - Notifications `invoice.issued` (on draft → issued) and `payment.verified` (deferred to commit, so the payload has the balance after the payment). Amounts in payloads are exact TEXT; templates format them with `formatMoneyText` (no floats, no imports in the shared sender code). New templates need a `notify-sender` redeploy.
- **Reminders (0023, AC-13):** `private.finance_daily()` runs daily at 04:00 UTC (pg_cron `ngb-finance-daily`; finance/admin can trigger `run_finance_reminders()` via "Send reminders now"). It first moves invoices past their due date (client's time zone) to overdue, then sends `invoice.reminder`.
  - Stages: `app_settings` `finance.reminder_stages` (days from due date; default -3, 0, 7, 14, 30). Only the LATEST stage reached is sent (no burst of missed ones), once per (invoice, stage): `invoice_reminders` is append-only and unique.
  - Skipped: disputed invoices, the issue date itself, clients with `organizations.payment_reminders` off (client form), and when payments awaiting verification cover the balance.
  - Finance users get `staff.invoice_overdue` (once per invoice) and `staff.invoice_disputed` (each dispute opened).
  - To test "time passing" in `test:db`, the harness disables `invoices_freeze` as the owner to move a due date; never do this on a real database.
- **Return, incidents, closure (0024, AC-14/15):** container return terms change only through `set_container_return_terms` (column UPDATE revoked); `private.refresh_return_status` (and hourly pg_cron `ngb-return-check`) moves delivered containers to `awaiting_empty_return` / `return_overdue`.
  - `record_container_condition`: damage (`minor_damage`, `damaged`) needs a note and opens a `container_damage` incident. Incidents and notes are append-only; only admin/ops_manager resolve them. Clients cannot read incidents.
  - `closure_checks` (pod, returned, incidents, exceptions, finance) is the single source for the checklist; `close_shipment` (admin/ops_manager) refuses with "Cannot close yet: …". Finance passes when paid or credit-approved (`approve_closure_credit`, finance/admin).
  - `reopen_shipment` needs a reason; `shipment_closure_log` keeps every close/reopen. Templates: `shipment.closed` (client), `staff.incident_reported` (ops).
- **Reports (0025, US-12):** `/admin/reports` reads `report_port_dwell`, `report_transit`, `report_delivery_performance` (admin/ops_manager; period ≤ 366 days) and `report_overdue_invoices` (finance readers). Read-only SECURITY DEFINER functions that check the role themselves; per container, completed legs only.
  - Dwell = discharge → gate-out vs port_processing + dispatch SLA; transit = gate-out → delivery vs route estimate (72 h without a route); on time = delivered by the ETA in force at gate-out (`private.eta_at_dispatch`) + `eta.material_hours_other`.
  - Live suite `tests/live/reports.mjs` is read-only and cross-checks the totals against the raw rows.
- **Security pass (0026, Sprint 5):** clearing agents see only the client organizations (and their users) of shipments assigned to them (`private.can_see_organization`); other office roles see all. Return deadline/depot can't be set by direct container INSERT.
  - `tests/live/security.mjs` reads every table as two clients, the driver and the agent and attributes every row; calls every RPC with nulls (anon must be refused); sends every server action as each role its guard excludes; guesses another client's ids. Read-only apart from refused calls.
  - `test:db` freezes which tables/columns signed-in users may write directly (`WRITE_GRANTS`, `COLUMN_GRANTS`). A new grant fails until it is reviewed and added to the list.
  - Server actions only execute on pages whose bundle includes them; posting an action id to another page runs nothing. So guards matter where several staff roles share a page.
- **Notification resilience (0027, AC-18):** `notification_health()` (admin/ops_manager) drives the status panel at the top of `/admin/notifications` (wording in `lib/domain/notifications.ts`): paused, not configured (Vault secrets missing), stalled (due > 10 min and no attempt for 10 min), failures, or normal. `retry_failed_deliveries(since, channel)` retries up to 500 failed deliveries queued since a time (offered periods: `RETRY_WINDOWS`), audited as `audit_log.record_id = 'bulk-retry'`. Admins pause/resume sending from the same page (`setSenderPaused`, app_settings RLS: admin only, audited). Live drill: `tests/live/outage.mjs`.
  - **Order (0028):** the claim returns rows oldest first by `notifications.created_at` (never reset by retries), and the sender sends one recipient's messages per channel one after another (`sender.ts`), so a backlog doesn't arrive out of order. A message retried after a failure can still arrive after newer ones.
- **Backups (Sprint 5):** `npm run backup:export` (read-only, service role, dev only unless `--project-ref`) writes `backups/<timestamp>/` (gitignored, 0700: personal data, never commit or upload); `npm run backup:restore-check -- <dir>` restores it into PGlite and checks checksums, row counts, FKs, CHECKs, money, documents↔files, derived flags, numbering and RLS. Runbook and drill results: `docs/backup-restore.md`. The PGlite Supabase stand-ins live in `tests/db/supabase-stubs.mjs` (shared with `test:db`).
- Forms that submit manually (keeping values on a refusal, converting local times to ISO) use `components/forms/use-form-action.ts`. Don't call `Date.now()` while rendering (lint purity rule): compute time-based flags in the DAL.
- **Testing server actions over HTTP:** POST to the page with a `Next-Action: <id>` header. Get the ID from `.next/server/server-reference-manifest.json`. Encode the arguments with React's `encodeReply` from `next/dist/compiled/react-server-dom-turbopack/client.node.js`. Field order matters when an action takes a FormData, so don't hand-build the encoding. POST to a page that actually uses the action (e.g. `/portal/shipments/<ref>` for document uploads). Other pages answer HTTP 200 with `{}` and the action never runs.
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
  - A "Security invariants" section checks every migration together: RLS on every public table, no `true` policies, `search_path` pinned on SECURITY DEFINER functions, nothing callable or writable by `anon`, views are `security_invoker`, only read-only private helpers are callable by signed-in users, append-only tables are not updatable. Keep it passing; don't add allow-list entries without a reason in a comment.
- `npm run check:secrets` (after `npm run build`, also in CI): scans what browsers download (`.next/static`, prerendered pages, `public/`) for server-only values from `.env.local` and for secret patterns (non-anon Supabase JWTs, `sb_secret_` keys, PEM keys). Prints names only.
- `npm run test:live`: real flows against the **dev** project and a local production server.
  - First run `npm run build && npx next start -p 3123`.
  - Suites are in `tests/live`: auth/routing, admin flows, documents, milestones, operations (ETA/transport/exceptions), notifications (push via a decrypting fake push service, mock WhatsApp, outage and retry), client portal, driver, PWA.
  - Every request times out after 60 s, so a stalled connection fails a check instead of freezing the run.
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
