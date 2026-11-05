-- ============================================================================
-- 0019 · Keep staff-only ETA reasons off the client-readable shipment row
--
-- revise_eta() copied every reason to shipments.eta_reason, including
-- revisions marked "not visible to the client"; clients can read their
-- shipment rows (RLS is per row), so the hidden reason was readable.
-- Now a hidden revision sets the neutral text "Schedule updated"; the real
-- reason stays in eta_revisions (staff-only for that row). Existing rows are
-- corrected from the latest revision.
-- ============================================================================

create or replace function public.revise_eta(
  p_shipment_id     uuid,
  p_new_eta         timestamptz,
  p_reason_category public.eta_reason_category,
  p_reason          text,
  p_client_visible  boolean default true
)
returns table (revision_id uuid, material boolean, minutes_changed integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role      public.app_role := private.current_app_role();
  s           public.shipments;
  v_reason    text := nullif(trim(p_reason), '');
  v_change    integer;
  v_threshold numeric;
  v_material  boolean;
  v_visible   boolean := coalesce(p_client_visible, true);
  v_id        uuid;
begin
  if v_role is null or v_role not in ('admin', 'ops_manager', 'doc_officer', 'clearing_agent', 'transport_coord') then
    raise exception 'You are not allowed to change the ETA' using errcode = '42501';
  end if;
  if not private.can_access_shipment(p_shipment_id) then
    raise exception 'Shipment not found' using errcode = 'P0002';
  end if;

  select * into s from public.shipments sh where sh.id = p_shipment_id for update;
  if not found then
    raise exception 'Shipment not found' using errcode = 'P0002';
  end if;
  if s.overall_status in ('delivered', 'container_returned', 'operationally_complete', 'closed') then
    raise exception 'The shipment is already delivered' using errcode = '55000';
  end if;
  if p_new_eta is null or p_new_eta < now() - interval '1 hour' then
    raise exception 'The new ETA cannot be in the past' using errcode = '22023';
  end if;
  if p_new_eta > now() + interval '180 days' then
    raise exception 'The new ETA is too far ahead' using errcode = '22023';
  end if;
  if v_reason is null or length(v_reason) < 3 then
    raise exception 'Give a reason for the ETA change' using errcode = '22023';
  end if;
  if length(v_reason) > 500 then
    raise exception 'The reason is too long' using errcode = '22023';
  end if;
  if s.current_eta is not null and s.current_eta = p_new_eta then
    raise exception 'The ETA is unchanged' using errcode = '22023';
  end if;

  v_change := case when s.current_eta is null then null
                   else round(extract(epoch from (p_new_eta - s.current_eta)) / 60)::integer end;
  -- "same-day" = the delivery was due within the next 24 hours
  v_threshold := case when s.current_eta is not null and s.current_eta <= now() + interval '24 hours'
                      then private.setting_numeric('eta.material_hours_same_day', 2)
                      else private.setting_numeric('eta.material_hours_other', 6) end;
  v_material := s.current_eta is null or abs(v_change) > v_threshold * 60;

  insert into public.eta_revisions (shipment_id, previous_eta, new_eta, change_minutes, reason_category, reason,
                                    is_material, threshold_hours, client_visible, notification_state)
  values (p_shipment_id, s.current_eta, p_new_eta, v_change, p_reason_category, v_reason,
          v_material, v_threshold, v_visible,
          case when v_material and v_visible then 'pending' else 'suppressed' end::public.notification_state)
  returning id into v_id;

  update public.shipments sh
     -- the shipment row is readable by the client: a staff-only reason stays in eta_revisions
     set current_eta = p_new_eta, eta_updated_at = now(),
         eta_reason = case when v_visible then v_reason else 'Schedule updated' end
   where sh.id = p_shipment_id;

  return query select v_id, v_material, v_change;
end;
$$;

update public.shipments s
   set eta_reason = case when r.client_visible then r.reason else 'Schedule updated' end
  from (select distinct on (er.shipment_id) er.shipment_id, er.reason, er.client_visible
          from public.eta_revisions er
         order by er.shipment_id, er.revised_at desc, er.id desc) r
 where r.shipment_id = s.id
   and s.eta_reason is distinct from case when r.client_visible then r.reason else 'Schedule updated' end;

revoke all on function public.revise_eta(uuid, timestamptz, public.eta_reason_category, text, boolean) from public, anon;
grant execute on function public.revise_eta(uuid, timestamptz, public.eta_reason_category, text, boolean) to authenticated;
