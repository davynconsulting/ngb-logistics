-- ============================================================================
-- 0017 · Pause switch for the notification sender
--
-- app_settings `notify.sender_paused` (admin-updatable, audited). While true:
-- deliveries keep queuing (nothing is lost), the pg_net kick is skipped, and
-- the deployed sender claims nothing. Used during a provider incident, and by
-- the live test suite, which then runs the sender itself with
-- p_ignore_pause => true (service role only).
-- ============================================================================

insert into public.app_settings (key, value, description) values
  ('notify.sender_paused', 'false', 'Pause outbound push/WhatsApp sending; deliveries keep queuing');

create or replace function private.sender_paused()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (s.value #>> '{}')::boolean from public.app_settings s where s.key = 'notify.sender_paused'), false)
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
  if current_setting('ngb.notify_kicked', true) = 'on' or private.sender_paused() then
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

drop function public.claim_notification_deliveries(integer);
create function public.claim_notification_deliveries(p_limit integer default 50, p_ignore_pause boolean default false)
returns table (
  delivery_id uuid, channel public.notification_channel, attempt_count integer,
  notification_id uuid, recipient_id uuid, template_key text, payload jsonb, shipment_id uuid,
  locale text, timezone text, whatsapp_phone text, subscriptions jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.sender_paused() and not coalesce(p_ignore_pause, false) then
    return;
  end if;

  -- messages nobody could send for a day are no longer useful
  update public.notification_deliveries d
     set state = 'failed', error_code = 'expired', error_detail = 'Not delivered within 24 hours', locked_until = null
   where d.state in ('pending', 'sending') and d.created_at < now() - interval '24 hours';

  return query
  with due as (
    select d.id from public.notification_deliveries d
     where (d.state = 'pending' and d.next_attempt_at <= now())
        or (d.state = 'sending' and d.locked_until < now())       -- sender crashed mid-way
     order by d.next_attempt_at
     limit least(greatest(coalesce(p_limit, 50), 1), 200)
     for update skip locked
  ), claimed as (
    update public.notification_deliveries d
       set state = 'sending', locked_until = now() + interval '5 minutes',
           attempt_count = d.attempt_count + 1, last_attempt_at = now()
      from due where d.id = due.id
    returning d.*
  )
  select c.id, c.channel, c.attempt_count, n.id, n.recipient_id, n.template_key, n.payload, n.shipment_id,
         coalesce(np.locale, 'en'),
         coalesce(n.payload ->> 'timezone', o.timezone, 'Africa/Kigali'),
         case when c.channel = 'whatsapp' and np.whatsapp_opt_in then np.whatsapp_phone end,
         case when c.channel = 'push' then coalesce((select jsonb_agg(jsonb_build_object(
                'endpoint', ps.endpoint, 'p256dh', ps.p256dh, 'auth', ps.auth))
                from public.push_subscriptions ps where ps.user_id = n.recipient_id), '[]'::jsonb) end
    from claimed c
    join public.notifications n on n.id = c.notification_id
    join public.profiles p on p.id = n.recipient_id
    left join public.organizations o on o.id = p.organization_id
    left join public.notification_preferences np on np.user_id = n.recipient_id;
end;
$$;

revoke all on function public.claim_notification_deliveries(integer, boolean) from public, anon, authenticated;
grant execute on function public.claim_notification_deliveries(integer, boolean) to service_role;
revoke all on function private.sender_paused() from public, anon, authenticated;
revoke all on function private.kick_notification_sender() from public, anon, authenticated;
