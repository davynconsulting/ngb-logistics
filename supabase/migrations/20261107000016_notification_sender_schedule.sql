-- ============================================================================
-- 0016 · Run the notification sender (edge function `notify-sender`)
--
-- - pg_net calls the function right after deliveries are queued (once per
--   transaction, sent after commit), and pg_cron calls it every minute to pick
--   up retries whose backoff has passed.
-- - The function URL and the shared secret live in Supabase Vault
--   (`notify_sender_url`, `notify_sender_secret`), never in this file. Until
--   both are set, the kick does nothing and deliveries simply wait.
-- - A failed kick never blocks the milestone/ETA/document change that queued
--   the notification (AC-18): the delivery stays pending for the next run.
-- ============================================================================

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  end if;
end;
$$;

create or replace function private.kick_notification_sender()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
begin
  -- once per transaction is enough: the sender claims everything that is due
  if current_setting('ngb.notify_kicked', true) = 'on' then
    return;
  end if;
  perform set_config('ngb.notify_kicked', 'on', true);

  if to_regnamespace('vault') is null or to_regnamespace('net') is null then
    return;
  end if;
  select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'notify_sender_url';
  select s.decrypted_secret into v_secret from vault.decrypted_secrets s where s.name = 'notify_sender_secret';
  if v_url is null or v_secret is null or v_url !~ '^https://' then
    return;
  end if;

  perform net.http_post(
    url := v_url,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 60000);
exception when others then
  raise warning 'notification sender kick failed: %', sqlerrm;
end;
$$;

create or replace function private.kick_sender_after_queue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.kick_notification_sender();
  return null;
end;
$$;

create trigger notification_deliveries_kick_sender
  after insert on public.notification_deliveries
  for each statement execute function private.kick_sender_after_queue();

revoke all on function private.kick_notification_sender() from public, anon, authenticated;
revoke all on function private.kick_sender_after_queue() from public, anon, authenticated;

-- every minute: retries whose backoff has passed, and anything a kick missed
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'ngb-notify-sender';
    perform cron.schedule('ngb-notify-sender', '* * * * *', 'select private.kick_notification_sender()');
  end if;
end;
$$;

-- Operations managers and admins diagnose failed deliveries (FRS §8: surface
-- failures to staff), so they can read the notification behind a delivery.
create policy notifications_select_leads on public.notifications
  for select to authenticated
  using ((select private.has_role('admin', 'ops_manager')));
