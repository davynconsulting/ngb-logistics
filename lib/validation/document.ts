import { z } from "zod";
import { ALLOWED_MIME_TYPES, DOCUMENT_TYPES, MAX_DOCUMENT_BYTES } from "@/lib/domain/documents";

const optionalId = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.uuid().optional());

/** Step 1 (before upload): what the browser intends to upload. */
export const prepareUploadSchema = z.object({
  shipmentId: z.uuid(),
  documentType: z.enum(DOCUMENT_TYPES as [string, ...string[]], { error: "Choose the document type" }),
  fileName: z.string().trim().min(1, "Choose a file").max(255, "File name is too long"),
  mimeType: z.enum(ALLOWED_MIME_TYPES, { error: "Only PDF, JPG, PNG, WebP or HEIC files can be uploaded" }),
  size: z.number().int().positive("The file is empty").max(MAX_DOCUMENT_BYTES, "The file is larger than 20 MB"),
  containerId: optionalId,
  replacesId: optionalId,
  clientVisible: z.boolean(),
});
export type PrepareUploadInput = z.input<typeof prepareUploadSchema>;

/** Step 3 (after upload): record the uploaded file. */
export const finalizeUploadSchema = z.object({
  documentId: z.uuid(),
  shipmentId: z.uuid(),
  documentType: z.enum(DOCUMENT_TYPES as [string, ...string[]]),
  path: z.string().min(1).max(600),
  fileName: z.string().trim().min(1).max(255),
  containerId: optionalId,
  replacesId: optionalId,
  clientVisible: z.boolean(),
});
export type FinalizeUploadInput = z.input<typeof finalizeUploadSchema>;

export const reviewSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("verified"), reason: z.string().optional() }),
  z.object({
    decision: z.literal("rejected"),
    reason: z.string().trim().min(3, "Say why the document is rejected (the client will see this)").max(500),
  }),
]);
