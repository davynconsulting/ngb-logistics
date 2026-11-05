"use server";

import { refresh } from "next/cache";
import { requireStaff, requireUser } from "@/lib/dal/session";
import { createClient } from "@/lib/supabase/server";
import {
  DOCUMENT_BUCKET, cleanFileName, documentStoragePath, uploadTypesFor, type DocumentType,
} from "@/lib/domain/documents";
import {
  finalizeUploadSchema, prepareUploadSchema, reviewSchema,
  type FinalizeUploadInput, type PrepareUploadInput,
} from "@/lib/validation/document";
import type { ActionState } from "@/lib/validation/common";

/*
 * Upload flow (files never pass through our server, so the 20 MB limit works on Vercel):
 *   1. prepareDocumentUpload: checks access, picks the storage path, and returns a
 *      signed upload token for exactly that path (created as the user → storage RLS).
 *   2. The browser uploads the file to Supabase Storage with that token.
 *   3. finalizeDocumentUpload: record_document() creates the metadata row as the
 *      user (documents RLS). Size and type are read from storage by the database.
 */

type Fail = { ok: false; error: string };
export type PrepareResult = { ok: true; documentId: string; path: string; token: string } | Fail;
export type FinalizeResult = { ok: true; version: number } | Fail;

const NOT_ALLOWED = "You can't upload this document type for this shipment.";

async function loadShipment(shipmentId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("shipments").select("id, client_id").eq("id", shipmentId).maybeSingle();
  return { supabase, shipment: data };
}

export async function prepareDocumentUpload(input: PrepareUploadInput): Promise<PrepareResult> {
  const user = await requireUser(); // staff, or a client uploading its commercial documents
  const parsed = prepareUploadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the file and try again." };
  const v = parsed.data;
  if (!uploadTypesFor(user.role).includes(v.documentType as DocumentType)) return { ok: false, error: NOT_ALLOWED };

  const { supabase, shipment } = await loadShipment(v.shipmentId);
  if (!shipment) return { ok: false, error: "Shipment not found." };

  if (v.containerId) {
    const { data } = await supabase.from("containers").select("id")
      .eq("id", v.containerId).eq("shipment_id", shipment.id).maybeSingle();
    if (!data) return { ok: false, error: "That container is not on this shipment." };
  }
  if (v.replacesId) {
    const { data: prev } = await supabase.from("documents").select("id, document_type")
      .eq("id", v.replacesId).eq("shipment_id", shipment.id).maybeSingle();
    if (!prev || prev.document_type !== v.documentType) return { ok: false, error: "The document to replace was not found." };
    const { count } = await supabase.from("documents").select("id", { count: "exact", head: true })
      .eq("replaces_document_id", v.replacesId);
    if (count) return { ok: false, error: "A newer version already exists. Reload the page." };
  }

  const documentId = crypto.randomUUID();
  const path = documentStoragePath(shipment.client_id, shipment.id, documentId, v.fileName);
  const { data, error } = await supabase.storage.from(DOCUMENT_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: NOT_ALLOWED };
  return { ok: true, documentId, path: data.path, token: data.token };
}

export async function finalizeDocumentUpload(input: FinalizeUploadInput): Promise<FinalizeResult> {
  const user = await requireUser();
  const parsed = finalizeUploadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "The upload could not be saved. Please try again." };
  const v = parsed.data;

  const { supabase, shipment } = await loadShipment(v.shipmentId);
  if (!shipment || !v.path.startsWith(`${shipment.client_id}/${shipment.id}/${v.documentId}/`)) {
    return { ok: false, error: "The upload could not be saved. Please try again." };
  }

  const { data, error } = await supabase.rpc("record_document", {
    p_document_id: v.documentId,
    p_shipment_id: shipment.id,
    p_document_type: v.documentType as DocumentType,
    p_storage_path: v.path,
    p_file_name: cleanFileName(v.fileName),
    p_container_id: v.containerId,
    p_replaces_document_id: v.replacesId,
    p_client_visible: user.role === "client" ? true : v.clientVisible, // a client's own upload is always visible to it
  });
  if (error) {
    if (error.code === "P0002") return { ok: false, error: "The upload didn't finish. Please try again." };
    if (error.code === "23505") return { ok: false, error: "Someone has just uploaded a newer version. Reload the page to see it." };
    if (error.code === "42501") return { ok: false, error: NOT_ALLOWED };
    return { ok: false, error: "The upload could not be saved. Please try again." };
  }
  refresh();
  return { ok: true, version: data?.[0]?.version ?? 1 };
}

export type ReviewState = ActionState;

/** Verify or reject the latest version of a pending document (admin, ops manager, doc officer). */
export async function reviewDocument(documentId: string, _prev: ReviewState, formData: FormData): Promise<ReviewState> {
  await requireStaff("admin", "ops_manager", "doc_officer");
  const parsed = reviewSchema.safeParse({
    decision: formData.get("decision"),
    reason: String(formData.get("reason") ?? ""),
  });
  if (!parsed.success) return { fieldErrors: { reason: parsed.error.issues.map((i) => i.message) } };

  const supabase = await createClient();
  const { error } = await supabase.rpc("review_document", {
    p_document_id: documentId,
    p_decision: parsed.data.decision,
    p_reason: parsed.data.decision === "rejected" ? parsed.data.reason : undefined,
  });
  if (error) {
    if (error.code === "55000") return { error: error.message }; // already reviewed / newer version exists
    if (error.code === "42501") return { error: "You are not allowed to review documents." };
    return { error: "The review could not be saved. Please try again." };
  }
  refresh();
  return { ok: true, message: parsed.data.decision === "verified" ? "Document verified." : "Document rejected." };
}

/** Show or hide a document from the client (admin, ops manager, doc officer). */
export async function setDocumentVisibility(documentId: string, visible: boolean): Promise<void> {
  await requireStaff("admin", "ops_manager", "doc_officer");
  const supabase = await createClient();
  await supabase.from("documents").update({ client_visible: visible }).eq("id", documentId);
  refresh();
}
