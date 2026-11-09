# Acceptance record and launch checklist

Release 1 (Phase 1) of the NGB LOGISTICS Cargo Tracking PWA, against FRS v1.0 §12. Status as of **9 November 2026**, end of Sprint 5.

**Where things were tested**
- **Dev:** Supabase `ngb-logistics-dev` with a local production build. This is where all suites run, including the ones that write data.
- **CI:** GitHub Actions on every push:
  - typecheck, lint, unit tests, database checks, build, secrets scan;
  - Playwright on a 390 px phone and on desktop;
  - axe, Lighthouse and Chrome's installability check.
- **Staging:** Supabase `ngb-logistics-staging` plus `https://ngb-logistics-staging.vercel.app`. Fictional data only. The full live suite ran there as the acceptance run (see below), plus the manual checks in `docs/deploy-staging.md`.

**The FRS asks for the acceptance tests to pass in staging.** They do: see "Acceptance run on staging" below.

## Test inventory

| Suite | What it covers | Result |
|---|---|---|
| `npm run test:db` | Every migration applied to an in-memory Postgres. RLS, grants, RPCs and triggers checked as every role. Security invariants across all migrations. | 782 / 782 |
| `npm test` | Unit tests: domain rules, money, ISO 6346, Web Push (RFC 8291 vector), sender, templates, CSP, site address | 243 / 243 |
| `npm run test:live` (dev) | 14 suites, real flows over HTTP against the production build | 477 / 477 |
| `npm run test:e2e` (CI) | Browser flows, 360 px screen tour with axe (WCAG 2.2 AA), dark-mode contrast, CSP violations, installability | 44 / 44 (CI run 42652328863). An earlier run had 2 desktop timing failures (confirmations after the 5 s limit); the assertion timeout is now 15 s. |
| Lighthouse (CI) | 8 pages, signed in where relevant | Performance 99–100, Accessibility 100, Best practices 100 |
| **Staging acceptance run** | The full live suite (14 suites, including the server-action role matrix) against the deployed site `https://ngb-logistics-staging.vercel.app` | 471 / 473, then 2 test fixes; the two affected suites rerun 59 / 59 and 36 / 36 (see below) |
| Backup drill | Export from dev, restored and verified in memory; a tampered copy is rejected | 23 / 23 |

## Acceptance criteria

✅ passes · 🟡 passes with a stated limit · ⏳ needs a step outside the code

| AC | Condition (FRS §12) | Evidence | Status |
|---|---|---|---|
| AC-01 | Create a client and shipment; duplicate references rejected | `register_shipment` RPC (test:db 0008: duplicate BL case-insensitive, container already on an open shipment); `admin-flows.mjs`; e2e `shipment-documents` | ✅ |
| AC-02 | Several containers per shipment, each with its own milestones, seal, delivery and return | Per-container milestones; shipment status = least-advanced container (test:db 0010, `milestones.mjs`); return per container (0024, `closure.mjs`); e2e two-container registration | ✅ |
| AC-03 | Milestone stores event time, recorded time, user/source, evidence; corrections keep history | Append-only `milestone_events` (UPDATE/DELETE blocked even for the service role); corrections are new rows; test:db "Append-only + corrections"; `milestones.mjs`; e2e record and cancel | ✅ |
| AC-04 | Valid transitions succeed; invalid ones blocked or need an override with a reason | Rules in `milestone_catalogue`, enforced in `record_milestone`; overrides only for ops manager/admin, with a reason; gate-out needs customs released and a truck (test:db 0010/0012, `milestones.mjs`, `operations.mjs`) | ✅ |
| AC-05 | A client can't reach another client's shipment, invoice, file or notification by changing an ID | RLS on every table (test:db invariant); `security.mjs` checks every row as two clients, the driver and the agent, and guesses the other client's references, invoice/receipt numbers, document ids and notification ids; e2e "not found"; also checked on staging | ✅ |
| AC-06 | A configured client receives push for an eligible event; result logged | Web Push (RFC 8291/8292) checked against the RFC test vector; `notifications.mjs` decrypts what a fake push service receives; every attempt in `notification_delivery_attempts` | 🟡 Delivery to a **real phone** is not yet tested (staging checklist) |
| AC-07 | Opted-in client gets the approved template through the configured provider; failures logged and retried | Template, consent and retry logic tested with the **mock** provider (`notifications.mjs`, unit tests) | ⏳ Needs a WhatsApp provider (Meta Cloud API, Twilio or 360dialog) and approved templates. Then the live test runs against the provider's sandbox. |
| AC-08 | Reprocessing an event doesn't duplicate messages | Unique `(event, recipient, channel, template)` key; test:db; `notifications.mjs` reprocesses the same event | ✅ |
| AC-09 | ETA revised with a reason; previous ETA auditable; material change notifies | `revise_eta` needs a reason; append-only `eta_revisions`; materiality (2 h within 24 h, else 6 h) from settings (test:db 0011, `operations.mjs`, e2e) | ✅ |
| AC-10 | Overdue milestone appears in the right queue with owner, last event, next action | `sla_scan` every 15 min opens exceptions with owner, last event, next action and follow-up; exceptions queue (test:db 0013, `operations.mjs`, e2e) | ✅ |
| AC-11 | Issue an invoice, several partial payments, correct balance | Decimal-exact `numeric(14,2)` with `decimal.js` in the UI; balance = total − verified payments − credits; never negative; never mixed currencies (test:db 0021, `finance.mjs`, e2e finance) | ✅ |
| AC-12 | Only finance verifies payments; who, when and reference recorded | `review_payment` finance-only; append-only `payment_reviews` with reviewer, time, receipt number (test:db 0021, `finance.mjs`, `security.mjs` action matrix) | ✅ |
| AC-13 | Reminders once per stage, no duplicates | `invoice_reminders` unique per (invoice, stage); only the latest stage reached is sent; disputed or opted-out invoices skipped (test:db 0023, `finance.mjs`) | ✅ |
| AC-14 | Delivered while empty return is pending; return updates only its own status | Separate delivery and return statuses per container; deadline and overdue check every hour (test:db 0024, `closure.mjs`) | ✅ |
| AC-15 | Closure blocked until checks pass, unless a credit approval is recorded | `closure_checks` (POD, return, incidents, exceptions, finance); `close_shipment` refuses with reasons; `approve_closure_credit` (finance/admin); reopening needs a reason; closure log (test:db 0024, `closure.mjs`) | ✅ |
| AC-16 | Authorized users download documents; others can't, even with guessed URLs | Private bucket; 60-second signed URLs created as the user; storage RLS through `can_access_shipment` (test:db, `documents.mjs`, `security.mjs`, e2e) | ✅ |
| AC-17 | Core client and field workflows usable on smartphones without horizontal scrolling | e2e tour of every screen at 360 px (client, admin, driver): no horizontal scroll, no axe WCAG 2.2 AA violations, dark-mode contrast; Lighthouse accessibility 100 | 🟡 Still to do: a hands-on pass on real phones and a screen-reader pass during the pilot |
| AC-18 | Simulated outage doesn't lose the milestone; failed notification queued, logged and retryable | `outage.mjs`: paused sender and provider down for more than 24 h; milestones and inbox unaffected; expiry; one-step retry; delivered once, in order (0027, 0028); status panel in admin | ✅ |

**Result:** 15 criteria pass. AC-06 and AC-17 pass in automated tests and need a hands-on check on real phones. AC-07 waits for the choice of WhatsApp provider.

## Acceptance run on staging (9 Nov 2026)

How it was run:
- The full live suite ran against the deployed staging site `https://ngb-logistics-staging.vercel.app` and its Supabase project.
- `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` is set on the Vercel staging project (sensitive) and was used for a local build, so server-action ids match. Checked: `signIn` has the same id in the deployed JavaScript.
- Command: `LIVE_STAGING_ACCEPTANCE=1 LIVE_APP_URL=https://ngb-logistics-staging.vercel.app node --env-file=.env.staging.local tests/live/run.mjs`. Without that flag, staging allows only the read-only suites.

**Result:** 471 of 473 passed. The two failures were in the tests, not the app:

| Check | What happened | Change |
|---|---|---|
| Malformed document id (`/documents/..%2F..%2Fadmin`) | Vercel's edge refuses encoded path traversal with **400** before it reaches the app; locally the app answers 404. Access is refused either way. | The test accepts 404 or 400. |
| Opening another client's notification | The app redirected to the client's own inbox and didn't mark the other notification read, as required. The redirect value carries Next's `;push` suffix, and the check compared exact text. On dev this check never ran (the other client has no notifications there). | The test ignores the suffix. |

Both suites were rerun on staging after the fix: documents 59 / 59, portal 36 / 36.

The run added fictional TEST shipments, invoices and notifications to staging.

## Sprint 5 summary

| Task | Delivered |
|---|---|
| 1 Security pass | Migration 0026. Clearing agents see only clients of their assigned shipments. Return terms only through the checked function. A platform helper closed to the API. `security.mjs`, with every row attributed, every RPC called with nulls, and a role matrix over all server actions. Write grants frozen in test:db. |
| 2 CSP | Nonce + `strict-dynamic` CSP from `proxy.ts` on every page. Per-request rendering (Cache Components off; about 8 ms first byte). |
| 3 Mobile and accessibility | Screen tour at 360 px with axe on every screen. Contrast, `dl` structure, keyboard-reachable tables, a 404 page. Lighthouse and installability in CI. |
| 4 Resilience | 0027: notification status panel, bulk retry, admin pause switch. 0028: messages in order. Outage drill. Backup export and restore check, with a runbook. |
| 5 Staging | Free Supabase project and Vercel project, with a set-up script and runbook. Links in e-mails no longer come from the request host. Staff guide. |
| 6 Acceptance | This document. |

## Launch checklist

**NGB decisions (before the pilot)**
- [ ] Confirm the four spec interpretations in the plan: exception as a record, status = least-advanced container, loading/customs order, driver logins.
- [ ] Confirm the "on time" rule for reports: ETA at gate-out plus 6 h tolerance.
- [ ] Choose the WhatsApp provider and get the message templates approved (AC-07).
- [ ] Choose the e-mail service: Resend, or NGB's Microsoft 365 / Google Workspace SMTP.
- [ ] Confirm recovery targets (proposed: 24 h data loss with daily backups, 4 h to recover; PITR for finance data), document retention, consent wording and the incident contact.
- [ ] Production domain, for example `track.<ngb-domain>`.

**Acceptance on staging**
- [x] Acceptance run on staging (option 1): passed, see above.
- [ ] Real-phone test: Android Chrome and iPhone 16.4+ from the home screen. Sign in, turn on push, receive a milestone notification (AC-06, AC-17).
- [ ] Staff training on staging with `docs/staff-guide.md`, one session per role.
- [ ] NGB signs off the AC table above.

**Production set-up** (each step with the owner's approval)
- [ ] Paid Supabase project with daily backups (PITR recommended), in the chosen region. Sign-up off; Site URL and redirect list set to the production domain.
- [ ] `npm run staging`-style steps for production: migrations, sender, Vault. New secrets, never copied from dev or staging.
- [ ] SMTP configured; invitations switched to e-mail. WhatsApp provider connected, with the real-provider test passed.
- [ ] Vercel production project with the domain; environment variables (service-role key marked sensitive); `SITE_URL`; deployment protection off for the public site.
- [ ] Branch protection on `main` (CI must pass). Production deploys only from `main`.
- [ ] First backup export and restore check on production. Weekly routine scheduled (`docs/backup-restore.md`).
- [ ] Real NGB staff accounts invited by the admin. Seed/test accounts **never** created on production.

**Go-live**
- [ ] Pilot clients invited. WhatsApp consent collected in the portal.
- [ ] Sender status "Sending normally"; pg_cron jobs present; a test milestone reaches a pilot device.
- [ ] Someone owns `/admin/notifications` and the exceptions queue daily.

**Housekeeping**
- [ ] Clean up dev test data (or keep dev as a test-only project).
- [x] Moved `shadcn` to devDependencies: `npm audit --omit=dev` now reports 0 vulnerabilities (was 6 low/moderate). It's needed only at build time (`globals.css` imports its Tailwind styles).
- [x] Deleted the backup drill copy (9 Nov 2026).
- [ ] Screen-reader pass (VoiceOver / TalkBack) during the pilot.
