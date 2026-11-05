-- ============================================================================
-- 0001 · Enumerated types (Sprint 1)
-- Controlled vocabularies from FRS §2 (roles), §4.1 (overall status) and
-- §4.2 (independent sub-statuses). Later sprints add their own enums
-- (milestone types, notification states, invoice status, …).
-- ============================================================================

-- Private schema for helper functions. It is NOT exposed through the Data API,
-- so these functions cannot be called directly as /rpc endpoints.
create schema if not exists private;
grant usage on schema private to authenticated, service_role;

-- FRS §2: user roles
create type public.app_role as enum (
  'admin',            -- System administrator
  'ops_manager',      -- Operations manager
  'doc_officer',      -- Documentation officer
  'clearing_agent',   -- Clearing agent (assigned shipments only)
  'transport_coord',  -- Transport coordinator
  'driver',           -- Driver / transporter (assigned shipments only)
  'finance',          -- Finance officer
  'client'            -- Client user (own organization only)
);

-- FRS §4.1: overall shipment status.
-- "Exception" is deliberately NOT a status: it is tracked separately
-- (shipments.has_open_exception + exceptions table in Sprint 2) so the last
-- operational milestone is preserved and can be resumed.
create type public.shipment_status as enum (
  'draft',
  'registered',
  'awaiting_documents',
  'vessel_arrived',
  'container_discharged',
  'port_processing',
  'ready_for_dispatch',
  'truck_assigned',
  'loading',
  'loaded',
  'in_transit',
  'arrived',
  'delivered',
  'container_returned',
  'operationally_complete',
  'closed'
);

-- FRS §4.2: independent sub-status tracks
create type public.doc_status as enum (
  'missing', 'received', 'under_review', 'complete', 'rejected'
);

create type public.customs_status as enum (
  'not_started', 'entry_in_preparation', 'submitted', 'inspection',
  'duties_pending', 'released', 'on_hold'
);

create type public.transport_status as enum (
  'unassigned', 'assigned', 'awaiting_loading', 'loaded', 'in_transit',
  'at_border', 'arrived', 'delayed'
);

create type public.delivery_status as enum (
  'pending', 'offloading', 'delivered', 'pod_pending', 'pod_received'
);

create type public.return_status as enum (
  'not_due', 'awaiting_empty_return', 'returned', 'return_overdue', 'dispute'
);

create type public.finance_status as enum (
  'not_invoiced', 'invoiced', 'partially_paid', 'paid', 'overdue',
  'disputed', 'credit_approved'
);

-- FRS §6.6: document types
create type public.document_type as enum (
  'bill_of_lading',
  'commercial_invoice',
  'packing_list',
  'certificate_of_origin',
  'delivery_order',
  'customs_entry',
  'release_order',
  'gate_pass',
  'transit_document',
  'proof_of_delivery',
  'container_return_receipt',
  'photo',
  'invoice',
  'receipt',
  'other'
);

create type public.verification_status as enum (
  'pending', 'verified', 'rejected'
);

-- FRS §3 step 04: seaport terminal vs inland container depot
create type public.location_kind as enum ('terminal', 'icd', 'in_transit', 'destination', 'depot');
