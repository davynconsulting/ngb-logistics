-- ============================================================================
-- 0014 · Notifications core (FRS §7, §7.1, AC-06, AC-07, AC-08)
--
--   notifications                 one message per recipient (the in-app inbox
--                                 and the notification history, FRS §10)
--   notification_deliveries       one row per channel (push / WhatsApp), with
--                                 a unique dedup key: event + recipient +
--                                 channel + template (AC-08)
--   notification_delivery_attempts  append-only log of every provider response
--   push_subscriptions            Web Push endpoints of a user's devices
--   notification_rules            which events notify whom, on which channels
--
-- Messages are QUEUED by triggers in the same transaction as the event, and
-- sent later by the notification sender (Supabase Edge Function, service role),
-- so a provider outage never blocks a milestone (FRS §7.1).
-- Payloads hold only client-safe facts; message text comes from fixed templates.
-- ============================================================================

create type public.notification_channel as enum ('push', 'whatsapp');
create type public.delivery_state as enum ('pending', 'sending', 'sent', 'failed', 'suppressed');
create type public.notification_audience as enum ('client', 'staff');

-- ---------------------------------------------------------------------------
-- Rules (data, like the milestone catalogue). Changed by migration only.
-- ---------------------------------------------------------------------------
create table public.notification_rules (
  template_key  text primary key check (template_key ~ '^[a-z_]+\.[a-z_]+$'),
  audience      public.notification_audience not null,
  push          boolean not null,
  whatsapp      boolean not null,
  description   text not null
);

insert into public.notification_rules (template_key, audience, push, whatsapp, description) values
  ('account.activated',                   'client', true, true,  'Client account activated'),
  ('milestone.shipment_confirmed',        'client', true, true,  'Shipment registered, documents received/missing'),
  ('milestone.vessel_arrived',            'client', true, true,  'Vessel arrived'),
  ('milestone.container_discharged',      'client', true, true,  'Container discharged'),
  ('milestone.port_processing_started',   'client', true, false, 'Port processing started'),
  ('milestone.ready_for_dispatch',        'client', true, false, 'Ready for dispatch'),
  ('milestone.truck_assigned',            'client', true, true,  'Truck assigned'),
  ('milestone.loading_started',           'client', true, false, 'Loading started'),
  ('milestone.loaded',                    'client', true, true,  'Container loaded'),
  ('milestone.gate_out',                  'client', true, true,  'Gate-out confirmed'),
  ('milestone.transit_checkpoint',        'client', true, false, 'Transit checkpoint'),
  ('milestone.arrived_at_border',         'client', true, false, 'Arrived at border'),
  ('milestone.border_crossed',            'client', true, false, 'Border crossed'),
  ('milestone.arrived',                   'client', true, true,  'Arrived at destination'),
  ('milestone.offloading_started',        'client', true, false, 'Offloading started'),
  ('milestone.delivered',                 'client', true, true,  'Delivered'),
  ('milestone.pod_received',              'client', true, true,  'Proof of delivery received'),
  ('milestone.empty_returned',            'client', true, true,  'Empty container returned'),
  ('milestone.customs_entry_prepared',    'client', true, false, 'Customs entry in preparation'),
  ('milestone.customs_submitted',         'client', true, false, 'Customs declaration submitted'),
  ('milestone.customs_inspection',        'client', true, true,  'Customs inspection (may need client action)'),
  ('milestone.customs_duties_pending',    'client', true, true,  'Duties pending (client action)'),
  ('milestone.customs_released',          'client', true, true,  'Customs released'),
  ('milestone.customs_on_hold',           'client', true, true,  'Customs on hold'),
  ('milestone.update',                    'client', true, false, 'Status update with a note'),
  ('eta.changed',                         'client', true, true,  'Material ETA change'),
  ('document.rejected',                   'client', true, true,  'Document rejected: client action needed'),
  ('shipment.alert',                      'client', true, true,  'Client-visible exception'),
  ('staff.exception_opened',              'staff',  true, false, 'SLA check opened an exception (owner)'),
  ('staff.exception_escalated',           'staff',  true, false, 'Exception escalated (owner + operations managers)');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.push_subscriptions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  endpoint         text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  p256dh           text not null check (length(p256dh) between 40 and 200),
  auth             text not null check (length(auth) between 10 and 100),
  user_agent       text check (length(user_agent) <= 300),
  created_at       timestamptz not null default now(),
  last_success_at  timestamptz,
  failure_count    integer not null default 0
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

create table public.notifications (
  id            uuid primary key default gen_random_uuid(),
  recipient_id  uuid not null references public.profiles (id) on delete cascade,
  audience      public.notification_audience not null,
  shipment_id   uuid references public.shipments (id) on delete cascade,
  event_key     text not null,
  template_key  text not null references public.notification_rules (template_key),
  payload       jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  read_at       timestamptz,
  unique (event_key, recipient_id, template_key)
);
create index notifications_recipient_idx on public.notifications (recipient_id, created_at desc);
create index notifications_shipment_idx on public.notifications (shipment_id);

create table public.notification_deliveries (
  id                   uuid primary key default gen_random_uuid(),
  notification_id      uuid not null references public.notifications (id) on delete cascade,
  channel              public.notification_channel not null,
  dedup_key            text not null unique,              -- event|recipient|channel|template (AC-08)
  state                public.delivery_state not null default 'pending',
  attempt_count        integer not null default 0,
  next_attempt_at      timestamptz not null default now(),
  locked_until         timestamptz,
  last_attempt_at      timestamptz,
  sent_at              timestamptz,
  provider_message_id  text,
  error_code           text,
  error_detail         text check (length(error_detail) <= 1000),
  created_at           timestamptz not null default now()
);
create index notification_deliveries_due_idx on public.notification_deliveries (next_attempt_at)
  where state in ('pending', 'sending');
create index notification_deliveries_failed_idx on public.notification_deliveries (created_at desc) where state = 'failed';

create table public.notification_delivery_attempts (
  id                   uuid primary key default gen_random_uuid(),
  delivery_id          uuid not null references public.notification_deliveries (id) on delete cascade,
  attempted_at         timestamptz not null default now(),
  ok                   boolean not null,
  provider_message_id  text,
  error_code           text,
  error_detail         text check (length(error_detail) <= 1000)
);
create index notification_delivery_attempts_delivery_idx on public.notification_delivery_attempts (delivery_id);

create trigger notification_delivery_attempts_append_only
  before update or delete on public.notification_delivery_attempts
  for each row execute function private.prevent_mutation();

-- WhatsApp consent time is set by the database, never by the client
-- (FRS §7.1: record consent, phone, timestamp and source). History: audit_log.
create or replace function private.stamp_whatsapp_consent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.whatsapp_opt_in and (not old.whatsapp_opt_in or new.whatsapp_phone is distinct from old.whatsapp_phone) then
    new.consent_at := now();
    new.consent_source := left(coalesce(nullif(trim(new.consent_source), ''), 'portal'), 50);
  elsif new.whatsapp_opt_in then
    new.consent_at := old.consent_at;
    new.consent_source := old.consent_source;
  end if;
  return new;
end;
$$;

create trigger notification_preferences_consent
  before update on public.notification_preferences
  for each row execute function private.stamp_whatsapp_consent();

-- ---------------------------------------------------------------------------
-- Queueing
-- ---------------------------------------------------------------------------

-- Queue one template for a set of recipients: an inbox row each, plus a push
-- and/or WhatsApp delivery as the rule and the recipient's preferences allow.
-- Re-running with the same event key adds nothing (AC-08).
create or replace function private.enqueue_notification(
  p_event_key   text,
  p_template    text,
  p_shipment_id uuid,
  p_payload     jsonb,
  p_recipients  uuid[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r       public.notification_rules;
  v_n     integer := 0;
  rec     record;
  v_id    uuid;
begin
  select * into r from public.notification_rules nr where nr.template_key = p_template;
  if not found or p_recipients is null then return 0; end if;

  for rec in
    select p.id, p.role, coalesce(np.push_enabled, true) as push_on,
           coalesce(np.whatsapp_opt_in, false) and np.whatsapp_phone is not null as wa_on
      from public.profiles p
      left join public.notification_preferences np on np.user_id = p.id
     where p.id = any (p_recipients) and p.is_active
       and ((r.audience = 'client') = (p.role = 'client'))   -- client templates only to clients, staff to staff
       -- a client only ever hears about its own organization's shipments
       and (p.role <> 'client' or p_shipment_id is null
            or p.organization_id = (select s.client_id from public.shipments s where s.id = p_shipment_id))
  loop
    insert into public.notifications (recipient_id, audience, shipment_id, event_key, template_key, payload)
    values (rec.id, r.audience, p_shipment_id, p_event_key, p_template, coalesce(p_payload, '{}'))
    on conflict (event_key, recipient_id, template_key) do nothing
    returning id into v_id;
    continue when v_id is null;
    v_n := v_n + 1;

    if r.push and rec.push_on then
      insert into public.notification_deliveries (notification_id, channel, dedup_key)
      values (v_id, 'push', concat_ws('|', p_event_key, rec.id, 'push', p_template))
      on conflict (dedup_key) do nothing;
    end if;
    if r.whatsapp and rec.wa_on and r.audience = 'client' then
      insert into public.notification_deliveries (notification_id, channel, dedup_key)
      values (v_id, 'whatsapp', concat_ws('|', p_event_key, rec.id, 'whatsapp', p_template))
      on conflict (dedup_key) do nothing;
    end if;
  end loop;
  return v_n;
end;
$$;

create or replace function private.client_recipients(p_shipment_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(p.id), '{}')
    from public.profiles p join public.shipments s on s.client_id = p.organization_id
   where s.id = p_shipment_id and p.role = 'client' and p.is_active
$$;

-- Shared shipment facts for client payloads (no internal fields)
create or replace function private.shipment_payload(p_shipment_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'shipment_id', s.id, 'reference', s.shipment_reference, 'bl_number', s.bl_number,
    'origin', p.name, 'destination', concat_ws(', ', s.destination_city, s.destination_country),
    'current_eta', s.current_eta, 'timezone', o.timezone)
  from public.shipments s
  join public.organizations o on o.id = s.client_id
  left join public.ports p on p.id = s.origin_port_id
  where s.id = p_shipment_id
$$;

-- Milestones: one message per recorded action (batch), built when the
-- transaction commits so every container of the batch is included.
create or replace function private.notify_milestone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
begin
  if new.correction_of_event_id is not null or not new.client_visible or new.notification_state <> 'pending' then
    return null;
  end if;
  if exists (select 1 from public.notifications n where n.event_key = 'milestone:' || new.batch_id) then
    return null;  -- another row of the same batch already queued it
  end if;

  select private.shipment_payload(new.shipment_id) || jsonb_build_object(
           'milestone', new.milestone_type,
           'label', (select c.label from public.milestone_catalogue c where c.milestone_type = new.milestone_type),
           'event_at', new.event_at,
           'location', new.location,
           'note', new.public_note,
           'containers', coalesce((select jsonb_agg(k.container_number order by k.container_number)
                                     from public.milestone_events e join public.containers k on k.id = e.container_id
                                    where e.batch_id = new.batch_id and e.correction_of_event_id is null), '[]'::jsonb),
           'missing_documents', case when new.milestone_type = 'shipment_confirmed' then
             coalesce((select jsonb_agg(dr.document_type order by dr.document_type) from public.document_requirements dr
                        where dr.shipment_id = new.shipment_id and dr.is_required and dr.status in ('missing', 'rejected')), '[]'::jsonb)
           end,
           'route', case when new.milestone_type = 'gate_out' then
             (select r.name from public.transport_assignments a join public.transport_assignment_containers ac on ac.assignment_id = a.id
               join public.routes r on r.id = a.route_id
              where ac.container_id = new.container_id and a.status = 'active' order by a.assigned_at desc limit 1)
           end)
    into v_payload;

  perform private.enqueue_notification('milestone:' || new.batch_id, 'milestone.' || new.milestone_type,
                                       new.shipment_id, jsonb_strip_nulls(v_payload), private.client_recipients(new.shipment_id));
  return null;
end;
$$;

create constraint trigger milestone_events_notify
  after insert on public.milestone_events
  deferrable initially deferred
  for each row execute function private.notify_milestone();

-- Material ETA change (the threshold is applied in revise_eta)
create or replace function private.notify_eta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_material and new.client_visible then
    perform private.enqueue_notification('eta:' || new.id, 'eta.changed', new.shipment_id,
      jsonb_strip_nulls(private.shipment_payload(new.shipment_id) || jsonb_build_object(
        'previous_eta', new.previous_eta, 'new_eta', new.new_eta, 'reason', new.reason, 'revised_at', new.revised_at)),
      private.client_recipients(new.shipment_id));
  end if;
  return null;
end;
$$;

create trigger eta_revisions_notify
  after insert on public.eta_revisions
  for each row execute function private.notify_eta();

-- A rejected required document asks the client to act
create or replace function private.notify_document_rejected()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'rejected' and old.status is distinct from 'rejected' then
    perform private.enqueue_notification(
      'docreq:' || new.id || ':' || floor(extract(epoch from clock_timestamp()))::bigint, 'document.rejected', new.shipment_id,
      jsonb_strip_nulls(private.shipment_payload(new.shipment_id) || jsonb_build_object(
        'document_type', new.document_type, 'reason', new.client_note, 'due_date', new.due_date)),
      private.client_recipients(new.shipment_id));
  end if;
  return null;
end;
$$;

create trigger document_requirements_notify
  after update of status on public.document_requirements
  for each row execute function private.notify_document_rejected();

-- Exceptions: client-visible ones tell the client (client message only);
-- SLA-opened and escalated ones alert staff.
create or replace function private.notify_exception()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff jsonb;
begin
  if new.status = 'open' and new.client_visible and new.client_message is not null
     and (tg_op = 'INSERT' or not old.client_visible or old.client_message is distinct from new.client_message) then
    perform private.enqueue_notification('exception:' || new.id || ':' || md5(new.client_message), 'shipment.alert', new.shipment_id,
      private.shipment_payload(new.shipment_id) || jsonb_build_object('message', new.client_message),
      private.client_recipients(new.shipment_id));
  end if;

  v_staff := jsonb_build_object('shipment_id', new.shipment_id, 'exception_id', new.id, 'title', new.title,
    'severity', new.severity, 'reference', (select s.shipment_reference from public.shipments s where s.id = new.shipment_id),
    'next_action', new.next_action);
  if tg_op = 'INSERT' and new.source = 'system' and new.owner_id is not null then
    perform private.enqueue_notification('exception_opened:' || new.id, 'staff.exception_opened', new.shipment_id,
      jsonb_strip_nulls(v_staff), array[new.owner_id]);
  end if;
  if tg_op = 'UPDATE' and new.escalated_at is not null and old.escalated_at is null then
    perform private.enqueue_notification('exception_escalated:' || new.id, 'staff.exception_escalated', new.shipment_id,
      jsonb_strip_nulls(v_staff),
      array(select p.id from public.profiles p where p.is_active and (p.role = 'ops_manager' or p.id = new.owner_id)));
  end if;
  return null;
end;
$$;

create trigger exceptions_notify
  after insert or update on public.exceptions
  for each row execute function private.notify_exception();

-- Welcome message when a client user account is created
create or replace function private.notify_account_activated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role = 'client' and new.is_active then
    perform private.enqueue_notification('account:' || new.id, 'account.activated', null,
      jsonb_build_object('organization', (select o.legal_name from public.organizations o where o.id = new.organization_id)),
      array[new.id]);
  end if;
  return null;
end;
$$;

create trigger profiles_notify_activated
  after insert on public.profiles
  for each row execute function private.notify_account_activated();

-- ---------------------------------------------------------------------------
-- Sender API (service role only): claim due deliveries, record the outcome.
-- Bounded backoff: retry after 1, 5, 15, 60 minutes; failed after 5 attempts.
-- ---------------------------------------------------------------------------
create or replace function public.claim_notification_deliveries(p_limit integer default 50)
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

create or replace function public.complete_notification_delivery(
  p_delivery_id         uuid,
  p_ok                  boolean,
  p_provider_message_id text default null,
  p_error_code          text default null,
  p_error_detail        text default null,
  p_permanent           boolean default false,
  p_suppress            boolean default false,       -- nothing to send to (no device / no consent)
  p_dead_endpoints      text[] default null          -- push endpoints the provider says are gone
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d        public.notification_deliveries;
  v_backoff integer[] := array[1, 5, 15, 60];
  v_detail text := left(p_error_detail, 1000);
begin
  select * into d from public.notification_deliveries x where x.id = p_delivery_id for update;
  if not found or d.state <> 'sending' then
    return;  -- already completed (e.g. a slow duplicate run)
  end if;

  insert into public.notification_delivery_attempts (delivery_id, ok, provider_message_id, error_code, error_detail)
  values (d.id, coalesce(p_ok, false), left(p_provider_message_id, 200), left(p_error_code, 100), v_detail);

  if p_dead_endpoints is not null then
    delete from public.push_subscriptions s where s.endpoint = any (p_dead_endpoints);
  end if;

  if p_ok then
    update public.notification_deliveries x
       set state = 'sent', sent_at = now(), locked_until = null, provider_message_id = left(p_provider_message_id, 200),
           error_code = null, error_detail = null
     where x.id = d.id;
    update public.push_subscriptions s set last_success_at = now(), failure_count = 0
      from public.notifications n
     where n.id = d.notification_id and s.user_id = n.recipient_id and d.channel = 'push';
  elsif p_suppress then
    update public.notification_deliveries x
       set state = 'suppressed', locked_until = null, error_code = left(p_error_code, 100), error_detail = v_detail
     where x.id = d.id;
  elsif p_permanent or d.attempt_count >= 5 then
    update public.notification_deliveries x
       set state = 'failed', locked_until = null, error_code = left(p_error_code, 100), error_detail = v_detail
     where x.id = d.id;
  else
    update public.notification_deliveries x
       set state = 'pending', locked_until = null, error_code = left(p_error_code, 100), error_detail = v_detail,
           next_attempt_at = now() + make_interval(mins => v_backoff[least(d.attempt_count, 4)])
     where x.id = d.id;
  end if;
end;
$$;

-- Staff: send a failed message again (operations manager / admin)
create or replace function public.retry_notification_delivery(p_delivery_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not coalesce(private.has_role('admin', 'ops_manager'), false) then
    raise exception 'Only an operations manager or admin can retry notifications' using errcode = '42501';
  end if;
  update public.notification_deliveries d
     set state = 'pending', next_attempt_at = now(), attempt_count = 0, created_at = now(),
         error_detail = coalesce(d.error_detail, '') || ' (retry requested)'
   where d.id = p_delivery_id and d.state = 'failed';
  if not found then
    raise exception 'Only failed notifications can be retried' using errcode = '55000';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------
alter table public.notification_rules             enable row level security;
alter table public.push_subscriptions             enable row level security;
alter table public.notifications                  enable row level security;
alter table public.notification_deliveries        enable row level security;
alter table public.notification_delivery_attempts enable row level security;

revoke all on public.notification_rules, public.push_subscriptions, public.notifications,
              public.notification_deliveries, public.notification_delivery_attempts from anon, authenticated;
grant select on public.notification_rules, public.notifications, public.notification_deliveries,
                public.notification_delivery_attempts to authenticated;
grant select, delete on public.push_subscriptions to authenticated;
grant insert (endpoint, p256dh, auth, user_agent) on public.push_subscriptions to authenticated;
grant update (read_at) on public.notifications to authenticated;

create policy notification_rules_select on public.notification_rules for select to authenticated
  using ((select private.current_app_role()) is not null);

-- Each user manages only their own devices
create policy push_subscriptions_select on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));
create policy push_subscriptions_insert on public.push_subscriptions for insert to authenticated
  with check (user_id = (select auth.uid()) and (select private.current_app_role()) is not null);
create policy push_subscriptions_delete on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));

-- Inbox: only the recipient (AC-05: nobody reads another user's notifications)
create policy notifications_select on public.notifications for select to authenticated
  using (recipient_id = (select auth.uid()) and (select private.current_app_role()) is not null);
create policy notifications_mark_read on public.notifications for update to authenticated
  using (recipient_id = (select auth.uid())) with check (recipient_id = (select auth.uid()));

-- Delivery log: own deliveries, plus operations managers / admins for monitoring
create policy notification_deliveries_select on public.notification_deliveries for select to authenticated
  using ((select private.has_role('admin', 'ops_manager'))
         or exists (select 1 from public.notifications n where n.id = notification_id and n.recipient_id = (select auth.uid())));
create policy notification_delivery_attempts_select on public.notification_delivery_attempts for select to authenticated
  using ((select private.has_role('admin', 'ops_manager')));

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.claim_notification_deliveries(integer)',
    'public.complete_notification_delivery(uuid, boolean, text, text, text, boolean, boolean, text[])'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  execute 'revoke all on function public.retry_notification_delivery(uuid) from public, anon';
  execute 'grant execute on function public.retry_notification_delivery(uuid) to authenticated';
  foreach f in array array[
    'private.enqueue_notification(text, text, uuid, jsonb, uuid[])', 'private.client_recipients(uuid)',
    'private.shipment_payload(uuid)', 'private.notify_milestone()', 'private.notify_eta()',
    'private.notify_document_rejected()', 'private.notify_exception()', 'private.notify_account_activated()',
    'private.stamp_whatsapp_consent()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end;
$$;
