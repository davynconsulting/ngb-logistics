import { Badge } from "@/components/ui/badge";
import { INVOICE_STATUS_LABELS, type InvoiceStatus } from "@/lib/domain/finance";
import { cn } from "@/lib/utils";

const styles: Record<InvoiceStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  issued: "bg-info/15 text-info",
  partially_paid: "bg-info/15 text-info",
  paid: "bg-success/15 text-success",
  overdue: "bg-destructive/10 text-destructive",
  disputed: "bg-warning/25 text-warning-foreground",
  void: "bg-muted text-muted-foreground line-through",
};

export function InvoiceStatusBadge({ status, className }: { status: InvoiceStatus; className?: string }) {
  return <Badge variant="secondary" className={cn(styles[status], className)}>{INVOICE_STATUS_LABELS[status]}</Badge>;
}
