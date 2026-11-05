-- ============================================================================
-- 0009 · Document workflow: upload recording, versioning, review, checklist
-- FRS §6.6 (document metadata + versioning), §3 step 02 (document checklist,
-- flag missing/invalid documents), §8 (document missing or rejected),
-- AC-16 (document access)
--
-- Files are uploaded straight from the browser to the private bucket with a
-- signed upload URL that the server issues for a path it chose. Afterwards
-- record_document() creates the metadata row; size and file type are always
-- taken from storage itself, never from the browser.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Linear version history: a version can be replaced by at most one newer
-- version. Two people uploading "v2" at the same time: the second one fails.
-- ---------------------------------------------------------------------------
create unique index documents_replaced_once
  on public.documents (replaces_document_id)
  where replaces_document_id is not null;

-- ---------------------------------------------------------------------------
-- Verification can only be recorded through review_document(), so the
-- reviewer and the time are always the real ones (database clock, auth.uid()).
-- Doc staff can still change client visibility directly (audited).
-- ---------------------------------------------------------------------------
revoke update (verification_status, verified_by, verified_at, rejection_reason)
  on public.documents from authenticated;

drop policy documents_update on public.documents;
create policy documents_update on public.documents
  for update to authenticated
  using ((select private.has_role('admin', 'ops_manager', 'doc_officer')))
  with check ((select private.has_role('admin', 'ops_manager', 'doc_officer')));

-- ---------------------------------------------------------------------------
-- File facts come from storage, never from the browser: on every insert the
-- size and file type are taken from the uploaded object, and a row for a file
-- that was never uploaded is refused. (The bucket itself enforces the 20 MB
-- limit and the allowed file types at upload.)
-- ---------------------------------------------------------------------------
create or replace function private.take_file_facts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_size bigint;
  v_mime text;
begin
  select (o.metadata ->> 'size')::bigint, o.metadata ->> 'mimetype'
    into v_size, v_mime
    from storage.objects o
   where o.bucket_id = 'shipment-documents'
     and o.name = new.storage_path;

  if v_size is null then
    -- Only users who may upload get this message; anyone else is refused by
    -- the insert policy instead (no hint about which files exist).
    if auth.uid() is null
       or private.has_role('admin', 'ops_manager', 'doc_officer', 'clearing_agent', 'driver') then
      raise exception 'The file has not been uploaded' using errcode = 'P0002';
    end if;
    return new;
  end if;

  new.size_bytes := v_size;
  new.mime_type  := v_mime;
  return new;
end;
$$;

revoke all on function private.take_file_facts() from public, anon, authenticated;

create trigger documents_file_facts
  before insert on public.documents
  for each row execute function private.take_file_facts();

-- ---------------------------------------------------------------------------
-- record_document: create the metadata row for an uploaded file (numbering
-- the version when it replaces an earlier one).
-- SECURITY INVOKER: the documents insert policy decides who may record which
-- document type for which shipment (e.g. agents only on assigned shipments).
-- ---------------------------------------------------------------------------
create or replace function public.record_document(
  p_document_id          uuid,
  p_shipment_id          uuid,
  p_document_type        public.document_type,
  p_storage_path         text,
  p_file_name            text,
  p_container_id         uuid default null,
  p_replaces_document_id uuid default null,
  p_client_visible       boolean default true
)
returns table (document_id uuid, version integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_version  integer := 1;
begin
  if p_replaces_document_id is not null then
    select d.version + 1 into v_version
      from public.documents d
     where d.id = p_replaces_document_id
       and d.shipment_id = p_shipment_id;
    if not found then
      raise exception 'The document to replace was not found' using errcode = 'P0002';
    end if;
  end if;

  insert into public.documents (
    id, shipment_id, container_id, document_type, storage_path, file_name,
    mime_type, size_bytes, version, replaces_document_id, client_visible
  ) values (
    p_document_id, p_shipment_id, p_container_id, p_document_type, p_storage_path,
    left(trim(p_file_name), 255),
    null, null,  -- size and type: filled in from storage by documents_file_facts
    v_version, p_replaces_document_id, coalesce(p_client_visible, true)
  );

  return query select p_document_id, v_version;
end;
$$;

revoke all on function public.record_document(uuid, uuid, public.document_type, text, text, uuid, uuid, boolean) from public, anon;
grant execute on function public.record_document(uuid, uuid, public.document_type, text, text, uuid, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- review_document: verify or reject the latest version of a pending document.
-- SECURITY DEFINER (verification columns are not writable by users), so the
-- role check below is the gate. The audit trigger still records the caller.
-- ---------------------------------------------------------------------------
create or replace function public.review_document(
  p_document_id uuid,
  p_decision    public.verification_status,
  p_reason      text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.verification_status;
begin
  if not private.has_role('admin', 'ops_manager', 'doc_officer') then
    raise exception 'You are not allowed to review documents' using errcode = '42501';
  end if;
  if p_decision is null or p_decision = 'pending' then
    raise exception 'Choose verified or rejected' using errcode = '22023';
  end if;
  if p_decision = 'rejected' and nullif(trim(p_reason), '') is null then
    raise exception 'Give a reason for the rejection' using errcode = '22023';
  end if;

  select d.verification_status into v_status
    from public.documents d where d.id = p_document_id
     for update;
  if not found then
    raise exception 'Document not found' using errcode = 'P0002';
  end if;
  if v_status <> 'pending' then
    raise exception 'This document has already been reviewed' using errcode = '55000';
  end if;
  if exists (select 1 from public.documents n where n.replaces_document_id = p_document_id) then
    raise exception 'A newer version exists: review that one' using errcode = '55000';
  end if;

  update public.documents
     set verification_status = p_decision,
         verified_by = auth.uid(),
         verified_at = now(),
         rejection_reason = case when p_decision = 'rejected' then left(trim(p_reason), 500) end
   where id = p_document_id;
end;
$$;

revoke all on function public.review_document(uuid, public.verification_status, text) from public, anon;
grant execute on function public.review_document(uuid, public.verification_status, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Checklist status follows the documents (latest version of each upload):
--   any verified → complete · else any pending → received
--   else any rejected → rejected (reason shown to the client) · else missing
-- ---------------------------------------------------------------------------
create or replace function private.refresh_requirement_status(p_shipment_id uuid, p_type public.document_type)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.doc_status;
  v_reason text;
begin
  select case
           when bool_or(d.verification_status = 'verified') then 'complete'
           when bool_or(d.verification_status = 'pending')  then 'received'
           when bool_or(d.verification_status = 'rejected') then 'rejected'
           else 'missing'
         end::public.doc_status,
         (array_agg(d.rejection_reason order by d.verified_at desc)
            filter (where d.verification_status = 'rejected'))[1]
    into v_status, v_reason
    from public.documents d
   where d.shipment_id = p_shipment_id
     and d.document_type = p_type
     and not exists (select 1 from public.documents n where n.replaces_document_id = d.id);

  update public.document_requirements r
     set status = v_status,
         client_note = case
           when v_status = 'rejected' then left('Rejected: ' || coalesce(v_reason, 'see document'), 500)
           when r.client_note like 'Rejected: %' then null
           else r.client_note
         end
   where r.shipment_id = p_shipment_id
     and r.document_type = p_type
     and (r.status is distinct from v_status
          or (v_status = 'rejected' and r.client_note is distinct from left('Rejected: ' || coalesce(v_reason, 'see document'), 500)));
end;
$$;

create or replace function private.on_document_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.refresh_requirement_status(new.shipment_id, new.document_type);
  return null;
end;
$$;

create trigger documents_refresh_checklist
  after insert or update of verification_status on public.documents
  for each row execute function private.on_document_change();

-- ---------------------------------------------------------------------------
-- Shipment document sub-status (FRS §4.2) follows its REQUIRED checklist:
--   rejected > missing > received > under_review > complete
-- ---------------------------------------------------------------------------
create or replace function private.refresh_shipment_doc_status(p_shipment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.doc_status;
begin
  select case
           when count(*) = 0 then null
           when bool_or(r.status = 'rejected')     then 'rejected'
           when bool_or(r.status = 'missing')      then 'missing'
           when bool_or(r.status = 'received')     then 'received'
           when bool_or(r.status = 'under_review') then 'under_review'
           else 'complete'
         end::public.doc_status
    into v_status
    from public.document_requirements r
   where r.shipment_id = p_shipment_id
     and r.is_required;

  if v_status is not null then
    update public.shipments
       set doc_status = v_status
     where id = p_shipment_id
       and doc_status is distinct from v_status;
  end if;
end;
$$;

create or replace function private.on_requirement_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A checklist item added after the document was uploaded starts with the right status
  if tg_op = 'INSERT' then
    perform private.refresh_requirement_status(new.shipment_id, new.document_type);
  end if;
  perform private.refresh_shipment_doc_status(coalesce(new.shipment_id, old.shipment_id));
  return null;
end;
$$;

create trigger document_requirements_refresh_shipment
  after insert or update or delete on public.document_requirements
  for each row execute function private.on_requirement_change();

revoke all on function private.refresh_requirement_status(uuid, public.document_type) from public, anon, authenticated;
revoke all on function private.refresh_shipment_doc_status(uuid) from public, anon, authenticated;
revoke all on function private.on_document_change() from public, anon, authenticated;
revoke all on function private.on_requirement_change() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- One-off: bring existing checklists and shipment document statuses in line
-- (derived values only; no documents or files are changed)
-- ---------------------------------------------------------------------------
select private.refresh_requirement_status(r.shipment_id, r.document_type)
  from (select distinct shipment_id, document_type from public.document_requirements) r;

select private.refresh_shipment_doc_status(s.id)
  from public.shipments s;
