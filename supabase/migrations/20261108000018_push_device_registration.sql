-- ============================================================================
-- 0018 · Push device registration
--
-- A browser has ONE push subscription per site. When someone else signs in on
-- a shared phone and turns notifications on, the device moves to them; the
-- previous user's row (which RLS hides from the new user) is removed so they
-- stop receiving notifications on a phone they no longer use.
-- Sign-out removes the device's subscription too (app: signOut action).
-- ============================================================================

create or replace function public.register_push_subscription(
  p_endpoint   text,
  p_p256dh     text,
  p_auth       text,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not exists (select 1 from public.profiles p where p.id = v_uid and p.is_active) then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if (select count(*) from public.push_subscriptions s where s.user_id = v_uid) >= 10
     and not exists (select 1 from public.push_subscriptions s where s.endpoint = p_endpoint and s.user_id = v_uid) then
    -- keep the 10 most recent devices
    delete from public.push_subscriptions s
     where s.id in (select x.id from public.push_subscriptions x where x.user_id = v_uid
                     order by coalesce(x.last_success_at, x.created_at) asc limit 1);
  end if;

  insert into public.push_subscriptions as s (user_id, endpoint, p256dh, auth, user_agent)
  values (v_uid, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, failure_count = 0, created_at = now();
end;
$$;

revoke all on function public.register_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.register_push_subscription(text, text, text, text) to authenticated;
