-- ============================================================================
-- 0027 · Notification resilience (Sprint 5, AC-18 outage drill)
--
-- 1. notification_health(): one row telling operations managers/admins whether
--    the sender is keeping up: messages waiting and the oldest one, the last
--    attempt and the last successful send, failures in the last 24 hours, the
--    pause switch, whether the sender is configured, and `stalled` = messages
--    have been due for over 10 minutes and nothing has been attempted for 10
--    minutes (sender down, Vault secret missing, pg_net failing).
-- 2. retry_failed_deliveries(since, channel): after a long provider outage,
--    puts every failed delivery queued since `since` back in the queue in one
--    step (at most 500 per call), instead of one Retry click each. Same rules
--    as retry_notification_delivery; the bulk action is written to audit_log.
--
-- Nothing is deleted or rewritten: the attempt log stays append-only.
-- ============================================================================

create or replace function public.notification_health()
returns table (
  pending_count     integer,
  oldest_pending_at timestamptz,
  last_attempt_at   timestamptz,
  last_sent_at      timestamptz,
  failed_24h        integer,
  sender_paused     boolean,
  sender_configured boolean,
  stalled           boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_configured boolean := false;
begin
  if not coalesce(private.has_role('admin', 'ops_manager'), false) then
    raise exception 'Only an operations manager or admin can see notification health' using errcode = '42501';
  end if;

  if to_regnamespace('vault') is not null then
    execute $q$select count(*) = 2 from vault.decrypted_secrets
                where name in ('notify_sender_url', 'notify_sender_secret') and coalesce(decrypted_secret, '') <> ''$q$
      into v_configured;
  end if;

  return query
  with q as (
    select count(*) filter (where d.state in ('pending', 'sending'))::integer as pending_count,
           min(d.created_at) filter (where d.state in ('pending', 'sending')) as oldest_pending_at,
           min(d.next_attempt_at) filter (where d.state = 'pending') as oldest_due_at,
           count(*) filter (where d.state = 'failed' and d.created_at >= now() - interval '24 hours')::integer as failed_24h
      from public.notification_deliveries d
  ), a as (
    select max(x.attempted_at) as last_attempt_at, max(x.attempted_at) filter (where x.ok) as last_sent_at
      from public.notification_delivery_attempts x
  )
  select q.pending_count, q.oldest_pending_at, a.last_attempt_at, a.last_sent_at, q.failed_24h,
         private.sender_paused(), v_configured,
         coalesce(q.oldest_due_at < now() - interval '10 minutes'
                  and (a.last_attempt_at is null or a.last_attempt_at < now() - interval '10 minutes'), false)
    from q, a;
end;
$$;

create or replace function public.retry_failed_deliveries(
  p_since   timestamptz,
  p_channel public.notification_channel default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not coalesce(private.has_role('admin', 'ops_manager'), false) then
    raise exception 'Only an operations manager or admin can retry notifications' using errcode = '42501';
  end if;
  if p_since is null or p_since > now() then
    raise exception 'Choose when the outage started' using errcode = '22023';
  end if;

  with picked as (
    select d.id from public.notification_deliveries d
     where d.state = 'failed' and d.created_at >= p_since
       and (p_channel is null or d.channel = p_channel)
     order by d.created_at
     limit 500
     for update skip locked
  )
  update public.notification_deliveries d
     set state = 'pending', next_attempt_at = now(), attempt_count = 0, created_at = now(),
         error_detail = coalesce(d.error_detail, '') || ' (retry requested)'
    from picked where d.id = picked.id;
  get diagnostics v_count = row_count;

  if v_count > 0 then
    insert into public.audit_log (actor_id, actor_role, table_name, record_id, action, new_data)
    values (auth.uid(), current_user, 'notification_deliveries', 'bulk-retry', 'UPDATE',
            jsonb_build_object('retried', v_count, 'since', p_since, 'channel', p_channel));
  end if;
  return v_count;
end;
$$;

revoke all on function public.notification_health() from public, anon;
revoke all on function public.retry_failed_deliveries(timestamptz, public.notification_channel) from public, anon;
grant execute on function public.notification_health() to authenticated;
grant execute on function public.retry_failed_deliveries(timestamptz, public.notification_channel) to authenticated;
