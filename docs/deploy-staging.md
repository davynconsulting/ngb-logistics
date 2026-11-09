# Staging environment

Staging is where NGB runs acceptance tests and staff training. The FRS requires the acceptance tests to pass "in a staging environment". **Staging holds fictional data only.** Real clients start on a paid production project, after acceptance.

Decisions (9 Nov 2026):

- **Database:** a separate free Supabase project, `ngb-logistics-staging`, in eu-west-1 (same region as dev). Free projects pause after about a week without use (resume from the dashboard) and have no downloadable backups. That's acceptable for fictional data.
- **Web address:** the Vercel address `https://ngb-logistics-staging.vercel.app`. Vercel functions run in Dublin (`vercel.json`), next to the database.
- **Email:** none yet. Admins send the one-time invitation link shown after adding a user. Password-reset emails use Supabase's built-in sender, which allows only a few per hour. Choose a provider before the pilot (see the end of this document).

Every step that creates or changes something on Supabase or Vercel needs the owner's approval first.

## 1. Supabase project

Each step prints names only, never secret values. Secrets are written to `.env.staging.local` (gitignored, owner-only).

| Step | Command | What it does |
|---|---|---|
| Create | `npm run staging -- create` | Creates the free project in the dev project's organization. Writes the URL, keys, project ref and database password to `.env.staging.local`. |
| Keys | `npm run staging -- keys` | Creates staging's own VAPID keys, sender secret and seed password, and sets `SITE_URL`. None are shared with dev. |
| Migrate (dry run) | `npm run staging -- migrate` | Shows the migrations that would be applied. |
| Migrate | `npm run staging -- migrate --apply` | Applies them, after approval. |
| Sender | `npm run staging -- sender` | Deploys `notify-sender`, sets its secrets (WhatsApp stays **mock**) and stores its address and secret in Vault. pg_cron then calls it every minute. |
| Seed | `npm run db:seed:staging` | Loads the same fictional data as dev. The seed script runs only against dev or the project named in `STAGING_PROJECT_REF`. |
| Status | `npm run staging -- status` | Lists what is set up and which migrations are applied. |

**Dashboard settings** (no CLI command covers these safely: `supabase config push` would overwrite them with the local development values). Under Authentication:

- **Sign In / Providers:** turn **off** "Allow new users to sign up". Only staff create accounts.
- **URL Configuration:**
  - Site URL: `https://ngb-logistics-staging.vercel.app`
  - Redirect URLs: `https://ngb-logistics-staging.vercel.app/**`

  Supabase refuses links to any address not on this list.

## 2. Vercel project

1. The owner signs in once in Terminal.app: `npx vercel login`. This needs a browser, so it can't run inside Claude.
2. Link the folder to a new project: `npx vercel link --project ngb-logistics-staging`.
3. Add the environment variables to the **Production** environment of that project. Values are piped from `.env.staging.local`, never typed on a command line.

   | Variable | Kind |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | public |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public (the publishable key) |
   | `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | public |
   | `SUPABASE_SERVICE_ROLE_KEY` | **secret**: mark it Sensitive |
   | `SITE_URL` | plain |

   The VAPID private key and sender secret live only in the Supabase function, not in Vercel.
4. Deploy: `npx vercel deploy --prod`. The build runs on Vercel.
5. Under Deployment Protection, leave Vercel Authentication **off** for the production address. Otherwise clients can't open the site and push notifications can't reach the service worker. Preview deployments can stay protected.

## 3. Check it

- From this Mac, against the staging address:
  - `/login` loads and sends the CSP header with a nonce;
  - `/admin` redirects to the login page when signed out;
  - signing in as `admin@ngb.example` (the staging seed password) reaches `/admin`.
- Run the read-only checks against staging, one suite at a time:

  ```sh
  LIVE_READ_ONLY=1 LIVE_APP_URL=https://ngb-logistics-staging.vercel.app node --env-file=.env.staging.local tests/live/security.mjs
  ```

  Also run `reports.mjs` the same way. Two parts of the security suite are skipped on staging:
  - **Server-action guards:** Next salts action ids per build, so they are known only for a local build. These checks run on dev against the same code.
  - **Invoice guessing:** the staging seed has no invoices.
- Do **not** run the full `test:live` suite against staging. It adds test data on every run. Run it only on dev.
- Record a milestone as ops and check that the client's inbox shows it, and that `/admin/notifications` says "Sending normally".
- Run Lighthouse on the staging address. The `pwa` installability check must pass over HTTPS.

## Set-up log: 9 Nov 2026

**Supabase project** `ngb-logistics-staging` (`xpyvsliyposdhnldmlcr`, eu-west-1, free)
- 28 migrations applied; the 4 pg_cron jobs exist.
- `notify-sender` deployed (WhatsApp mock); its address and secret are in Vault.
- Fictional seed loaded: 168 records, 20 shipments.
- Public sign-up turned off; confirmed through `/auth/v1/settings`.

**Vercel project** `ngb-logistics-staging` (account `davynconsulting-4238`)
- Deployed from the CLI. It isn't connected to GitHub because the Vercel account has no GitHub login connection, so CI doesn't deploy it.
- Production address: `https://ngb-logistics-staging.vercel.app`. Edge in Cape Town, functions in Dublin.
- `.vercelignore` keeps backups, env files, client reference PDFs and tests out of the upload.
- `vercel link` adds a short-lived `VERCEL_OIDC_TOKEN` to `.env.local`. It was removed: the app doesn't use it, and `.env.local` is the dev file.

**Checks**
- Pages and the PWA files answer; `/admin` redirects to the login page when signed out.
- Nonce CSP with `connect-src` limited to the staging Supabase; HSTS, `frame-ancestors none`/DENY and the other headers are present.
- Security suite 19/19 (two sections skipped, see above). Reports suite 15/15.
- A milestone recorded as ops reached the client's inbox. The deployed sender handled it within seconds ("not needed": no phone registered yet).
- Still to do on a real phone: install from the home screen and turn on push. Lighthouse and the installability check run in CI against a local build.

## 4. Before the pilot (real clients, production project)

- Production Supabase project on a paid plan with daily backups. PITR is recommended for finance data. See `docs/backup-restore.md`.
- An email provider (Resend, or NGB's Microsoft 365 / Google Workspace SMTP), configured under Authentication → Emails → SMTP. Then switch invitations from copied links to sent emails.
- A WhatsApp provider. Until then, WhatsApp stays mock and only push and in-app notifications reach people.
- An NGB domain for production, for example `track.<ngb-domain>`, added to Vercel and to the Supabase redirect list.
- Confirm the privacy items with NGB: retention, consent wording and incident contact.
