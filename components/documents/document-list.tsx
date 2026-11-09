import { Download, Eye, EyeOff, FileText, Image as ImageIcon } from "lucide-react";
import { setDocumentVisibility } from "@/lib/actions/documents";
import {
  DOCUMENT_TYPE_LABELS, VERIFICATION_LABELS, formatBytes, versionChains,
  type DocumentType, type VerificationStatus,
} from "@/lib/domain/documents";
import { formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ReviewControls } from "./review-controls";
import { DocumentUploadForm } from "./upload-form";

export type DocumentItem = {
  id: string;
  document_type: DocumentType;
  container_id: string | null;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_at: string;
  verification_status: VerificationStatus;
  verified_at: string | null;
  rejection_reason: string | null;
  client_visible: boolean;
  version: number;
  replaces_document_id: string | null;
  uploader: { full_name: string } | null;
  reviewer: { full_name: string } | null;
};

const statusClass: Record<VerificationStatus, string> = {
  pending: "bg-warning/25 text-warning-foreground dark:text-warning",
  verified: "bg-success/15 text-success",
  rejected: "bg-destructive/10 text-destructive",
};

export function VerificationBadge({ status }: { status: VerificationStatus }) {
  return <Badge variant="secondary" className={statusClass[status]}>{VERIFICATION_LABELS[status]}</Badge>;
}

/** Documents grouped by version history: latest version first, earlier versions folded away. */
export function DocumentList({
  shipmentId, documents, containers, timeZone, uploadTypes, canReview,
}: {
  shipmentId: string;
  documents: DocumentItem[];
  containers: { id: string; label: string }[];
  timeZone: string;
  uploadTypes: DocumentType[];
  canReview: boolean;
}) {
  const chains = versionChains(documents);
  const containerLabel = (id: string | null) => containers.find((c) => c.id === id)?.label;

  if (chains.length === 0) {
    return <p className="text-sm text-muted-foreground">No documents uploaded yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {chains.map(({ latest: d, history }) => {
        const Icon = d.mime_type.startsWith("image/") ? ImageIcon : FileText;
        const container = containerLabel(d.container_id);
        return (
          <li key={d.id} className="flex flex-col gap-3 rounded-md border p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex min-w-0 gap-2">
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0">
                  <p className="font-medium">
                    {DOCUMENT_TYPE_LABELS[d.document_type]}
                    {container && <span className="font-mono text-sm text-muted-foreground"> · {container}</span>}
                  </p>
                  <p className="truncate text-sm">{d.file_name}</p>
                  <p className="text-xs text-muted-foreground">
                    v{d.version} · {formatBytes(d.size_bytes)} · {d.uploader?.full_name ?? "NGB staff"} · {formatDate(d.uploaded_at, timeZone)}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-1">
                {!d.client_visible && <Badge variant="outline">Internal</Badge>}
                <VerificationBadge status={d.verification_status} />
              </div>
            </div>

            {d.verification_status === "rejected" && d.rejection_reason && (
              <p className="rounded bg-destructive/10 px-2 py-1 text-sm text-destructive">Rejected: {d.rejection_reason}</p>
            )}
            {d.verification_status !== "pending" && d.verified_at && (
              <p className="text-xs text-muted-foreground">
                {VERIFICATION_LABELS[d.verification_status]} by {d.reviewer?.full_name ?? "NGB staff"}, {formatDate(d.verified_at, timeZone)}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant="outline">
                <a href={`/documents/${d.id}`} target="_blank" rel="noopener noreferrer"><Eye aria-hidden /> View</a>
              </Button>
              <Button asChild size="sm" variant="ghost">
                <a href={`/documents/${d.id}?download=1`}><Download aria-hidden /> Download</a>
              </Button>
              {canReview && (
                <form action={setDocumentVisibility.bind(null, d.id, !d.client_visible)}>
                  <Button type="submit" size="sm" variant="ghost">
                    {d.client_visible ? <><EyeOff aria-hidden /> Hide from client</> : <><Eye aria-hidden /> Show to client</>}
                  </Button>
                </form>
              )}
            </div>

            {canReview && d.verification_status === "pending" && <ReviewControls documentId={d.id} />}

            {uploadTypes.includes(d.document_type) && (
              <details className="group rounded-md bg-muted/40 px-3 py-2">
                <summary className="cursor-pointer text-sm font-medium">Upload a new version</summary>
                <div className="pt-3">
                  <DocumentUploadForm shipmentId={shipmentId} types={uploadTypes} containers={containers}
                    replaces={{ id: d.id, type: d.document_type, containerId: d.container_id, clientVisible: d.client_visible }} />
                </div>
              </details>
            )}

            {history.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">Earlier versions ({history.length})</summary>
                <ul className="mt-2 flex flex-col gap-1 border-l pl-3">
                  {history.map((h) => (
                    <li key={h.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span className={cn("min-w-0 truncate", h.verification_status === "rejected" && "text-muted-foreground")}>
                        v{h.version} · {h.file_name} · {formatDate(h.uploaded_at, timeZone)}
                        {h.rejection_reason ? ` · rejected: ${h.rejection_reason}` : ""}
                      </span>
                      <a className="text-primary underline-offset-4 hover:underline" href={`/documents/${h.id}`} target="_blank" rel="noopener noreferrer">View</a>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        );
      })}
    </ul>
  );
}
