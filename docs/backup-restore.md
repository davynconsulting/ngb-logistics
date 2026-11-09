# Backup and restore runbook

FRS §10: "backup database and documents; define restore procedures". The first drill was run on 9 November 2026 against the dev project.

## What protects the data

| Layer | Covers | Who | Notes |
|---|---|---|---|
| Supabase platform backups | Whole database, including auth (password hashes) | Supabase | Daily backups and point-in-time recovery depend on the plan. **Production must be on a plan with daily backups. PITR is recommended for finance data.** Storage files are *not* in the database backups. |
| Logical export (`npm run backup:export`) | Every public table, auth users (no password hashes), every stored document | NGB (admin) | Independent of the platform. Read-only. Uses the service role. Files go in `backups/<timestamp>/`. |
| Restore check (`npm run backup:restore-check -- <dir>`) | Proves an export is complete and consistent | NGB (admin) | Runs in memory. Touches no real database. |

## Targets (proposed; NGB to confirm)

- **RPO (data loss accepted):** 24 h with daily platform backups, or minutes with PITR. Between platform backups, a weekly logical export (more often during the pilot) keeps an off-platform copy that includes the documents.
- **RTO (time to be back):** 4 h. Measured in the drill: export 5 min (142 files, 33,559 rows; later runs download 8 files at a time), load and verify 12 s. Creating a new project and redeploying the app takes most of the time.

## Drill results: 9 Nov 2026 (dev)

Export `backups/2026-11-09T07-52-17-247Z`: 38 tables, 33,559 rows, 29 users, 142 files (114 KiB). **The restore check passed 23 of 23:**

- every file matches its checksum;
- every table has its exported row count;
- all 80 foreign keys and 127 CHECK constraints hold;
- money adds up: invoice totals, verified payments, credit notes, balances never negative, one currency per invoice;
- every document has its file, at the recorded size;
- `has_open_exception` agrees with the open exceptions;
- invoice and shipment numbering continue without reuse;
- a client sees exactly their own shipments on the restored data;
- append-only history still refuses an UPDATE.

**Negative test:** a tampered copy failed as expected. The copy had:

- a corrupted file;
- one shipment removed;
- one invoice's payments changed;
- a document path broken;
- an exception closed with no resolution.

The check reported **8 failures**, including the two follow-on failures from the missing shipment. Error output never prints row contents.

## Routine

1. Weekly during the pilot, and before every migration on production: `npm run backup:export`, then `npm run backup:restore-check -- backups/<timestamp>`.
2. Copy the folder to NGB's encrypted storage. **Never** put it in git, e-mail or a shared drive: it holds names, phone numbers and client documents. Locally it's owner-only (0700) and gitignored.
3. Keep 4 weekly exports and delete older ones. Retention must match NGB's privacy policy (FRS §10).

## Restoring for real

Each step changes production and needs the owner's approval.

1. **Decide the point to restore to.** Prefer the platform restore (it brings back password hashes): Dashboard → Database → Backups (or PITR) → restore. This replaces the project's database in place.
2. If the project itself is lost, **create a new project** in the same region.
   - Apply the migrations: `npx supabase link`, then `npx supabase db push --remote`.
   - Load the latest export as the owner, through `psql` with `session_replication_role = replica`, table by table. Use the same order and approach as `scripts/backup-restore-check.mjs`. Then rebuild `private.shipment_reference_counters` from the shipment references (the script shows the SQL).
   - Recreate the users through the Auth admin API with the exported ids and `app_metadata`. Everyone then resets their password: hashes are not exported.
   - Upload the files to the `shipment-documents` bucket at the same paths.
3. **Reconnect the rest.**
   - Set the Vault secrets `notify_sender_url` and `notify_sender_secret`.
   - Deploy `notify-sender` and set its secrets.
   - Point Vercel's `NEXT_PUBLIC_SUPABASE_*` and `SUPABASE_SERVICE_ROLE_KEY` at the new project and redeploy.
   - Check that the pg_cron jobs exist: `ngb-sla-scan`, `ngb-notify-sender`, `ngb-finance-daily`, `ngb-return-check`.
4. **Pause the sender first** (`/admin/notifications` → Pause sending). Old queued messages would otherwise go out again. Look at the queue, use bulk retry only for what is still relevant, then resume.
5. Run the restore check against a fresh export of the restored project. Then do a smoke test as a client, as ops and as finance.

## Not covered yet

- A full restore onto a separate Supabase project, to time the real RTO. This needs a staging project (Task 5) and costs money; it needs approval.
- Finance numbering for credit notes and receipts is checked only through the shared `document_sequences` table. The check covers invoice numbers explicitly.
