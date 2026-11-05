
import { openNotification } from "@/lib/actions/portal";
import { inboxEntry } from "@/lib/domain/portal";
import type { InboxItem } from "@/lib/dal/portal";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Notifications; opening one marks it read and goes to the shipment. */
export function InboxList({ items, timeZone, empty = "No notifications yet." }: { items: InboxItem[]; timeZone: string; empty?: string }) {
  if (items.length === 0) return <p className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="flex flex-col divide-y rounded-lg border bg-card">
      {items.map((n) => {
        const e = inboxEntry(n, timeZone);
        return (
          <li key={n.id}>
            <form action={openNotification.bind(null, n.id)}>
              <button type="submit" className="flex w-full gap-3 p-4 text-left hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none">
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-primary")}
                  aria-label={n.read_at ? undefined : "Unread"} />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className={cn("text-sm break-words", !n.read_at && "font-semibold")}>{e.title}</span>
                  <span className="text-sm break-words text-muted-foreground">{e.body}</span>
                  <span className="text-xs text-muted-foreground">{formatDateTime(n.created_at, timeZone)}</span>
                </span>
              </button>
            </form>
          </li>
        );
      })}
    </ul>
  );
}

