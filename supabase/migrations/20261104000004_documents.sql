-- ============================================================================
-- 0004 · Documents: metadata, requirement checklist, private storage bucket
-- FRS §6.6 (document storage metadata), §3 step 02 (document checklist)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- documents: metadata for files in the private 'shipment-documents' bucket.
-- storage_path is an object key, never a public URL (FRS §6.6).
-- Path convention: {client_id}/{shipment_id}/{document_id}/{file_name}
-- Documents are never deleted; a new version references the one it replaces.
-- ---------------------------------------------------------------------------
create table public.documents (
  id                    uuid primary key default gen_random_uuid(),
  shipment_id           uuid not null references public.shipments (id) on delete restrict,
  container_id          uuid references public.containers (id) on delete restrict,
  document_type         public.document_type not null,
  storage_path          text not null unique,
  file_name             text not null check (length(file_name) between 1 and 255),
  mime_type             text not null check (mime_type in (
                          'application/pdf', 'image/jpeg', 'image/png',
                          'image/webp', 'image/heic')),
  size_bytes            bigint not null check (size_bytes > 0 and size_bytes <= 20971520),
  uploaded_by           uuid not null default auth.uid() references public.profiles (id),
  uploaded_at           timestamptz not null default now(),
  verification_status   public.verification_status not null default 'pending',
  verified_by           uuid references public.profiles (id),
  verified_at           timestamptz,
  rejection_reason      text,
  version               integer not null default 1 check (version >= 1),
  replaces_document_id  uuid references public.documents (id),
  -- Internal documents (e.g. customs working papers) stay hidden from clients
  client_visible        boolean not null default true,

  constraint verification_recorded check (
    verification_status = 'pending'
    or (verified_by is not null and verified_at is not null)
  ),
  constraint rejection_has_reason check (
    verification_status <> 'rejected' or rejection_reason is not null
  ),
  constraint version_chain check (
    (version = 1) = (replaces_document_id is null)
  )
);

create index documents_shipment_id_idx on public.documents (shipment_id);
create index documents_container_id_idx on public.documents (container_id) where container_id is not null;

-- Storage path must sit under the shipment's own client/shipment folder,
-- and a container (if any) must belong to the same shipment.
create or replace function private.check_document_consistency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client uuid;
begin
  select s.client_id into v_client from public.shipments s where s.id = new.shipment_id;

  if split_part(new.storage_path, '/', 1) <> v_client::text
     or split_part(new.storage_path, '/', 2) <> new.shipment_id::text
     or split_part(new.storage_path, '/', 3) <> new.id::text then
    raise exception 'storage_path must be {client_id}/{shipment_id}/{document_id}/{file_name}';
  end if;

  if new.container_id is not null and not exists (
    select 1 from public.containers c
    where c.id = new.container_id and c.shipment_id = new.shipment_id
  ) then
    raise exception 'Container does not belong to this shipment';
  end if;

  if new.replaces_document_id is not null and not exists (
    select 1 from public.documents d
    where d.id = new.replaces_document_id
      and d.shipment_id = new.shipment_id
      and d.document_type = new.document_type
      and d.version = new.version - 1
  ) then
    raise exception 'A new version must replace the previous version of the same document';
  end if;

  return new;
end;
$$;

create trigger documents_consistency_check
  before insert on public.documents
  for each row execute function private.check_document_consistency();

-- ---------------------------------------------------------------------------
-- document_requirements: per-shipment checklist (drives doc_status and
-- "missing document" alerts)
-- ---------------------------------------------------------------------------
create table public.document_requirements (
  id             uuid primary key default gen_random_uuid(),
  shipment_id    uuid not null references public.shipments (id) on delete cascade,
  document_type  public.document_type not null,
  is_required    boolean not null default true,
  status         public.doc_status not null default 'missing',
  -- Explanation shown to the client when action is needed
  client_note    text,
  due_date       date,
  updated_at     timestamptz not null default now(),
  unique (shipment_id, document_type)
);

create trigger document_requirements_updated_at
  before update on public.document_requirements
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Private storage bucket (20 MB limit, PDFs and images only)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'shipment-documents',
  'shipment-documents',
  false,
  20971520,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do nothing;
