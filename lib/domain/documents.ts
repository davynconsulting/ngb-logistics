import type { Database } from "@/lib/supabase/database.types";
import type { AppRole } from "@/lib/auth/roles";

export type DocumentType = Database["public"]["Enums"]["document_type"];
export type VerificationStatus = Database["public"]["Enums"]["verification_status"];
export type DocStatus = Database["public"]["Enums"]["doc_status"];

export const DOCUMENT_BUCKET = "shipment-documents";

/** Mirrors the bucket's limit and the documents.size_bytes check (20 MB). */
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

/** Mirrors the bucket's allowed types and the documents.mime_type check. */
export const ALLOWED_MIME_TYPES = [
  "application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic",
] as const;
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];
export const ACCEPT_ATTRIBUTE = ".pdf,.jpg,.jpeg,.png,.webp,.heic,application/pdf,image/jpeg,image/png,image/webp,image/heic";

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  bill_of_lading: "Bill of lading",
  commercial_invoice: "Commercial invoice",
  packing_list: "Packing list",
  certificate_of_origin: "Certificate of origin",
  delivery_order: "Delivery order",
  customs_entry: "Customs entry",
  release_order: "Release order",
  gate_pass: "Gate pass",
  transit_document: "Transit document",
  proof_of_delivery: "Proof of delivery (POD)",
  container_return_receipt: "Container return receipt",
  photo: "Photo",
  invoice: "Invoice",
  receipt: "Receipt",
  other: "Other",
};
export const DOCUMENT_TYPES = Object.keys(DOCUMENT_TYPE_LABELS) as DocumentType[];

export const VERIFICATION_LABELS: Record<VerificationStatus, string> = {
  pending: "Awaiting review",
  verified: "Verified",
  rejected: "Rejected",
};

export const DOC_STATUS_LABELS: Record<DocStatus, string> = {
  missing: "Missing",
  received: "Received",
  under_review: "Under review",
  complete: "Complete",
  rejected: "Rejected",
};

/** Evidence types that clearing agents and drivers may upload (same list as the documents_insert policy). */
const FIELD_EVIDENCE_TYPES: DocumentType[] = [
  "customs_entry", "release_order", "gate_pass", "transit_document",
  "proof_of_delivery", "container_return_receipt", "photo", "other",
];

/** Commercial documents NGB asks clients for (migration 0015). Always visible to the client. */
export const CLIENT_UPLOAD_TYPES: DocumentType[] = [
  "bill_of_lading", "commercial_invoice", "packing_list", "certificate_of_origin", "other",
];

/** Document types a role may upload. The database policy is the real gate; this only shapes the UI. */
export function uploadTypesFor(role: AppRole): DocumentType[] {
  if (role === "admin" || role === "ops_manager" || role === "doc_officer") return DOCUMENT_TYPES;
  if (role === "clearing_agent" || role === "driver") return FIELD_EVIDENCE_TYPES;
  if (role === "client") return CLIENT_UPLOAD_TYPES;
  return [];
}

export function canReviewDocuments(role: AppRole): boolean {
  return role === "admin" || role === "ops_manager" || role === "doc_officer";
}

const EXTENSION_MIME: Record<string, AllowedMimeType> = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg",
  png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heic",
};

/**
 * The file type to upload with. Browsers sometimes report HEIC photos as ""
 * or "image/heif", so fall back to the extension. Returns null if not allowed.
 */
export function resolveMimeType(fileName: string, reported: string): AllowedMimeType | null {
  const r = reported.toLowerCase();
  if ((ALLOWED_MIME_TYPES as readonly string[]).includes(r)) return r as AllowedMimeType;
  if (r === "image/heif" || r === "" || r === "application/octet-stream") {
    const ext = fileName.toLowerCase().split(".").pop() ?? "";
    return EXTENSION_MIME[ext] ?? null;
  }
  return null;
}

/** A display name: no path parts or control characters, at most 255 characters. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  return (cleaned || "document").slice(0, 255);
}

/**
 * A storage-safe object name (ASCII letters, digits, dot, dash, underscore),
 * keeping the extension. The original name is kept in documents.file_name.
 */
export function storageFileName(name: string): string {
  const clean = cleanFileName(name).normalize("NFKD").replace(/[̀-ͯ]/g, "");
  const dot = clean.lastIndexOf(".");
  const ext = dot > 0 ? clean.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) : "";
  const stem = (dot > 0 ? clean.slice(0, dot) : clean)
    .replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 80);
  return `${stem || "document"}${ext ? `.${ext}` : ""}`;
}

/** {client_id}/{shipment_id}/{document_id}/{file}: the layout the database and storage policies expect. */
export function documentStoragePath(clientId: string, shipmentId: string, documentId: string, fileName: string): string {
  return `${clientId}/${shipmentId}/${documentId}/${storageFileName(fileName)}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type Versioned = { id: string; replaces_document_id: string | null; version: number };

/**
 * Groups documents into version chains. Returns one entry per chain: the latest
 * version plus its older versions (newest first). Chains are linear (the
 * database allows each version to be replaced only once).
 */
export function versionChains<T extends Versioned>(docs: readonly T[]): { latest: T; history: T[] }[] {
  const byId = new Map(docs.map((d) => [d.id, d]));
  const replaced = new Set(docs.map((d) => d.replaces_document_id).filter((x): x is string => !!x));
  return docs
    .filter((d) => !replaced.has(d.id))
    .map((latest) => {
      const history: T[] = [];
      let prev = latest.replaces_document_id ? byId.get(latest.replaces_document_id) : undefined;
      while (prev && history.length < 100) {
        history.push(prev);
        prev = prev.replaces_document_id ? byId.get(prev.replaces_document_id) : undefined;
      }
      return { latest, history };
    });
}
