import { CheckCircle2, CircleAlert, CircleDashed, Download, Eye, FileText, Image as ImageIcon } from "lucide-react";
import {
  CLIENT_UPLOAD_TYPES, DOC_STATUS_LABELS, DOCUMENT_TYPE_LABELS, formatBytes, versionChains,
  type DocStatus, type DocumentType,
} from "@/lib/domain/documents";
import type { ClientShipment } from "@/lib/dal/portal";
import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { VerificationBadge } from "@/components/documents/document-list";
import { DocumentUploadForm } from "@/components/documents/upload-form";

const REQ_ICON: Record<DocStatus, typeof CheckCircle2> = {
  missing: CircleDashed, received: CircleDashed, under_review: CircleDashed, complete: CheckCircle2, rejected: CircleAlert,
};

/** Checklist, documents shared with the client, and the client's own uploads. */
export function ClientDocuments({ s, timeZone, canUpload }: { s: ClientShipment; timeZone: string; canUpload: boolean }) {
  const containers = s.containers.map((c) => ({ id: c.id, label: c.container_number }));
  const chains = versionChains(s.documents);
  const needed = s.document_requirements.filter((r) => r.is_required && ["missing", "rejected"].includes(r.status));
  const firstNeeded = needed.find((r) => CLIENT_UPLOAD_TYPES.includes(r.document_type))?.document_type as DocumentType | undefined;

  return (
    <div className="flex flex-col gap-5">
      {s.document_requirements.length > 0 && (
        <ul className="flex flex-col gap-2">
          {s.document_requirements.filter((r) => r.is_required).map((r) => {
            const Icon = REQ_ICON[r.status];
            const tone = r.status === "complete" ? "text-success" : r.status === "rejected" ? "text-destructive" : "text-muted-foreground";
            return (
              <li key={r.id} className="flex items-start gap-2 text-sm">
                <Icon className={`mt-0.5 size-4 shrink-0 ${tone}`} aria-hidden />
                <span className="min-w-0">
                  <span className="font-medium">{DOCUMENT_TYPE_LABELS[r.document_type]}</span>
                  <span className="text-muted-foreground"> · {DOC_STATUS_LABELS[r.status]}</span>
                  {r.due_date && r.status !== "complete" && <span className="text-muted-foreground"> · due {formatDate(r.due_date, timeZone)}</span>}
                  {r.client_note && <span className="block break-words text-muted-foreground">{r.client_note}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {chains.length === 0 ? (
        <p className="text-sm text-muted-foreground">No documents shared yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {chains.map(({ latest: d, history }) => {
            const Icon = d.mime_type.startsWith("image/") ? ImageIcon : FileText;
            const container = containers.find((c) => c.id === d.container_id)?.label;
            const canReplace = canUpload && d.verification_status === "rejected" && CLIENT_UPLOAD_TYPES.includes(d.document_type);
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
                        v{d.version} · {formatBytes(d.size_bytes)} · {d.uploader?.full_name ?? "NGB LOGISTICS"} · {formatDate(d.uploaded_at, timeZone)}
                        {history.length > 0 && ` · ${history.length} earlier version${history.length === 1 ? "" : "s"}`}
                      </p>
                    </div>
                  </div>
                  <VerificationBadge status={d.verification_status} />
                </div>
                {d.verification_status === "rejected" && d.rejection_reason && (
                  <p className="rounded bg-destructive/10 p-2 text-sm break-words text-destructive">Not accepted: {d.rejection_reason}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button asChild size="sm" variant="outline">
                    <a href={`/documents/${d.id}`} target="_blank" rel="noopener noreferrer"><Eye aria-hidden /> View</a>
                  </Button>
                  <Button asChild size="sm" variant="ghost">
                    <a href={`/documents/${d.id}?download=1`}><Download aria-hidden /> Download</a>
                  </Button>
                </div>
                {canReplace && (
                  <details className="rounded-md bg-muted/40 p-3">
                    <summary className="cursor-pointer text-sm font-medium">Upload a corrected copy</summary>
                    <div className="mt-3">
                      <DocumentUploadForm shipmentId={s.id} types={CLIENT_UPLOAD_TYPES} containers={containers} chooseVisibility={false}
                        replaces={{ id: d.id, type: d.document_type, containerId: d.container_id, clientVisible: true }} />
                    </div>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canUpload && (
        <div className="flex flex-col gap-3 rounded-md border border-dashed p-4">
          <div>
            <h3 className="font-medium">Send us a document</h3>
            <p className="text-sm text-muted-foreground">Bill of lading, commercial invoice, packing list or certificate of origin. Our team checks it and lets you know.</p>
          </div>
          <DocumentUploadForm shipmentId={s.id} types={CLIENT_UPLOAD_TYPES} containers={containers} defaultType={firstNeeded} chooseVisibility={false} />
        </div>
      )}
    </div>
  );
}
