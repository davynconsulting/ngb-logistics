"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { finalizeDocumentUpload, prepareDocumentUpload } from "@/lib/actions/documents";
import {
  ACCEPT_ATTRIBUTE, DOCUMENT_BUCKET, DOCUMENT_TYPE_LABELS, MAX_DOCUMENT_BYTES, resolveMimeType,
  type DocumentType,
} from "@/lib/domain/documents";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { FormField } from "@/components/forms/form-field";
import { FormAlert } from "@/components/auth/form-alert";

/**
 * Uploads a document straight from the browser to private storage:
 * prepare (server picks the path + signed token) → upload → record (server).
 */
export function DocumentUploadForm({
  shipmentId, types, containers, defaultType, replaces,
}: {
  shipmentId: string;
  types: DocumentType[];
  containers: { id: string; label: string }[];
  defaultType?: DocumentType;
  /** Upload a new version of this document (type and container are kept). */
  replaces?: { id: string; type: DocumentType; containerId: string | null; clientVisible: boolean };
}) {
  const router = useRouter();
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setDone(null);
    const fd = new FormData(e.currentTarget);
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) return setError("Choose a file to upload.");
    const mimeType = resolveMimeType(file.name, file.type);
    if (!mimeType) return setError("Only PDF, JPG, PNG, WebP or HEIC files can be uploaded.");
    if (file.size > MAX_DOCUMENT_BYTES) return setError("The file is larger than 20 MB.");

    const documentType = replaces?.type ?? String(fd.get("document_type") ?? "");
    if (!documentType) return setError("Choose the document type.");
    const containerId = replaces ? (replaces.containerId ?? "") : String(fd.get("container_id") ?? "");
    const clientVisible = fd.get("client_visible") === "on";

    setPending(true);
    try {
      const common = { shipmentId, documentType, containerId, replacesId: replaces?.id, clientVisible };
      const prep = await prepareDocumentUpload({ ...common, fileName: file.name, mimeType, size: file.size });
      if (!prep.ok) return setError(prep.error);

      const { error: uploadError } = await createClient()
        .storage.from(DOCUMENT_BUCKET)
        .uploadToSignedUrl(prep.path, prep.token, file, { contentType: mimeType });
      if (uploadError) return setError("The upload failed. Check your connection and try again.");

      const saved = await finalizeDocumentUpload({ ...common, documentId: prep.documentId, path: prep.path, fileName: file.name });
      if (!saved.ok) return setError(saved.error);

      formRef.current?.reset();
      setDone(`${file.name} uploaded${saved.version > 1 ? ` as version ${saved.version}` : ""}.`);
      router.refresh();
    } catch {
      setError("The upload failed. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {error && <FormAlert kind="error">{error}</FormAlert>}
      {done && <FormAlert kind="success">{done}</FormAlert>}
      <div className="grid gap-4 sm:grid-cols-2">
        {!replaces && (
          <FormField id={`${id}-type`} label="Document type">
            <NativeSelect id={`${id}-type`} name="document_type" defaultValue={defaultType ?? ""} required>
              <option value="">Choose…</option>
              {types.map((t) => <option key={t} value={t}>{DOCUMENT_TYPE_LABELS[t]}</option>)}
            </NativeSelect>
          </FormField>
        )}
        {!replaces && containers.length > 0 && (
          <FormField id={`${id}-container`} label="Container" description="Optional: only if it concerns one container">
            <NativeSelect id={`${id}-container`} name="container_id" defaultValue="">
              <option value="">Whole shipment</option>
              {containers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </NativeSelect>
          </FormField>
        )}
        <FormField id={`${id}-file`} label="File" description="PDF or photo (JPG, PNG, WebP, HEIC), up to 20 MB"
          className={replaces ? "sm:col-span-2" : "sm:col-span-2"}>
          <Input id={`${id}-file`} name="file" type="file" accept={ACCEPT_ATTRIBUTE} required
            className="h-auto py-2 file:mr-3 file:rounded file:bg-secondary file:px-2 file:py-1" />
        </FormField>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="client_visible" defaultChecked={replaces?.clientVisible ?? true} className="size-4 accent-primary" />
        Client can see this document
      </label>
      <div>
        <Button type="submit" disabled={pending} className="w-full sm:w-auto">
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />}
          {pending ? "Uploading…" : replaces ? "Upload new version" : "Upload document"}
        </Button>
      </div>
    </form>
  );
}
