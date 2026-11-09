import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  SHIPMENT_STATUS_LABELS,
  shipmentStatusTone,
  type ShipmentStatus,
  type StatusTone,
} from "@/lib/domain/status-labels";

const TONES: Record<StatusTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-info/15 text-info",
  progress: "bg-primary/10 text-primary",
  success: "bg-success/15 text-success",
  warning: "bg-warning/25 text-warning-foreground dark:text-warning",
};

export function ShipmentStatusBadge({ status, exception }: { status: ShipmentStatus; exception?: boolean }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Badge variant="secondary" className={cn("border-transparent", TONES[shipmentStatusTone(status)])}>
        {SHIPMENT_STATUS_LABELS[status]}
      </Badge>
      {exception && (
        <Badge variant="secondary" className="border-transparent bg-warning/25 text-warning-foreground dark:text-warning">
          Exception
        </Badge>
      )}
    </span>
  );
}
