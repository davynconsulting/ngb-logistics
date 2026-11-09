-- ============================================================================
-- 0028 · Send each person's notifications in the order they happened
--
-- Found by the outage drill (tests/live/outage.mjs): after a backlog (pause,
-- outage, bulk retry) a client received "vessel arrived" before "shipment
-- confirmed". claim_notification_deliveries returned its batch in no order and
-- picked ties (same next_attempt_at, e.g. after a bulk retry) arbitrarily.
-- Now it picks and returns rows oldest first by the notification's own time
-- (notifications.created_at, never reset by a retry); the sender sends one
-- person's messages per channel one after another (sender.ts).
-- Same signature, grants and behaviour otherwise. A message that fails and is
-- retried later can still arrive after newer ones (as with any retry).
-- ============================================================================

create or replace function public.claim_notification_deliveries(p_limit integer default 50, p_ignore_pause boolean default false)
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
      join public.notifications n on n.id = d.notification_id
     where (d.state = 'pending' and d.next_attempt_at <= now())
        or (d.state = 'sending' and d.locked_until < now())       -- sender crashed mid-way
     order by d.next_attempt_at, n.created_at, d.id
     limit least(greatest(coalesce(p_limit, 50), 1), 200)
     for update of d skip locked
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
    left join public.notification_preferences np on np.user_id = n.recipient_id
   order by n.created_at, c.id;
end;
$$;
