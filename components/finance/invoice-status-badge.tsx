import { Badge } from "@/components/ui/badge";
import { CLIENT_INVOICE_STATUS_LABELS, INVOICE_STATUS_LABELS, type InvoiceStatus } from "@/lib/domain/finance";
import { cn } from "@/lib/utils";

const styles: Record<InvoiceStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  issued: "bg-info/15 text-info",
  partially_paid: "bg-info/15 text-info",
  paid: "bg-success/15 text-success",
  overdue: "bg-destructive/10 text-destructive",
  disputed: "bg-warning/25 text-warning-foreground dark:text-warning",
  void: "bg-muted text-muted-foreground line-through",
};

/** Staff wording by default; `client` uses the portal wording ("Under review", "Cancelled"). */
export function InvoiceStatusBadge({ status, className, client }: { status: InvoiceStatus; className?: string; client?: boolean }) {
  const label = (client ? CLIENT_INVOICE_STATUS_LABELS : INVOICE_STATUS_LABELS)[status];
  return <Badge variant="secondary" className={cn(styles[status], className)}>{label}</Badge>;
}
