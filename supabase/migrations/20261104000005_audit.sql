-- ============================================================================
-- 0005 · Append-only audit trail
-- FRS §4 transition controls ("never silently delete or overwrite"),
-- §11 auditability ("record who changed what and when")
-- ============================================================================

create table public.audit_log (
  id           bigint generated always as identity primary key,
  occurred_at  timestamptz not null default now(),
  actor_id     uuid,           -- auth.uid(); null for service-role/system changes
  actor_role   text,           -- database role (authenticated / service_role / postgres)
  table_name   text not null,
  record_id    text,
  action       text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_data     jsonb,
  new_data     jsonb,
  changed      text[]          -- column names changed (UPDATE only)
);

comment on table public.audit_log is
  'Append-only. Written only by triggers; UPDATE and DELETE are blocked for every role.';

create index audit_log_table_record_idx on public.audit_log (table_name, record_id);
create index audit_log_occurred_at_idx  on public.audit_log (occurred_at desc);

-- ---------------------------------------------------------------------------
-- Generic row-audit trigger
-- ---------------------------------------------------------------------------
create or replace function private.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old     jsonb;
  v_new     jsonb;
  v_changed text[];
begin
  if tg_op in ('UPDATE', 'DELETE') then v_old := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_new := to_jsonb(new); end if;

  if tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key)
      into v_changed
      from jsonb_each(v_new) n
     where n.key <> 'updated_at'
       and n.value is distinct from (v_old -> n.key);
    -- Nothing meaningful changed (e.g. only updated_at): skip
    if v_changed is null then
      return null;
    end if;
  end if;

  insert into public.audit_log
    (actor_id, actor_role, table_name, record_id, action, old_data, new_data, changed)
  values (
    auth.uid(),
    coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
             current_user::text),
    tg_table_name,
    coalesce(v_new ->> 'id', v_old ->> 'id',
             v_new ->> 'user_id', v_old ->> 'user_id',
             v_new ->> 'shipment_id', v_old ->> 'shipment_id'),
    tg_op,
    v_old,
    v_new,
    v_changed
  );
  return null;  -- AFTER trigger
end;
$$;

-- Attach to every Sprint 1 business table
create trigger audit_organizations after insert or update or delete on public.organizations
  for each row execute function private.audit_row();
create trigger audit_profiles after insert or update or delete on public.profiles
  for each row execute function private.audit_row();
create trigger audit_notification_preferences after insert or update or delete on public.notification_preferences
  for each row execute function private.audit_row();
create trigger audit_ports after insert or update or delete on public.ports
  for each row execute function private.audit_row();
create trigger audit_shipments after insert or update or delete on public.shipments
  for each row execute function private.audit_row();
create trigger audit_containers after insert or update or delete on public.containers
  for each row execute function private.audit_row();
create trigger audit_shipment_assignments after insert or update or delete on public.shipment_assignments
  for each row execute function private.audit_row();
create trigger audit_documents after insert or update or delete on public.documents
  for each row execute function private.audit_row();
create trigger audit_document_requirements after insert or update or delete on public.document_requirements
  for each row execute function private.audit_row();

-- ---------------------------------------------------------------------------
-- Append-only enforcement. Reusable by later sprints for milestone_events,
-- eta_revisions and payments. Blocks UPDATE/DELETE even for the service role.
-- ---------------------------------------------------------------------------
create or replace function private.prevent_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only: % is not allowed', tg_table_name, tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger audit_log_append_only
  before update or delete on public.audit_log
  for each row execute function private.prevent_mutation();

create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function private.prevent_mutation();
