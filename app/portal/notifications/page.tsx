import type { Metadata } from "next";
import { Suspense } from "react";
import { requireClient } from "@/lib/dal/session";
import { getOrgTimezone, listNotifications } from "@/lib/dal/portal";
import { markAllRead } from "@/lib/actions/portal";
import { PageHeader } from "@/components/layout/page-header";
import { InboxList } from "@/components/portal/inbox-list";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Notifications" };

export default function NotificationsPage() {
  return (
    <Suspense>
      <Inbox />
    </Suspense>
  );
}

async function Inbox() {
  const user = await requireClient();
  const [items, tz] = await Promise.all([listNotifications({ limit: 100 }), getOrgTimezone(user.organizationId)]);
  const unread = items.some((n) => !n.read_at);
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col">
      <PageHeader title="Notifications" description="Updates on your shipments. The same messages are sent to your devices and WhatsApp if you turned them on."
        actions={unread && <form action={markAllRead}><Button type="submit" variant="outline" size="sm">Mark all read</Button></form>} />
      <InboxList items={items} timeZone={tz} />
    </div>
  );
}
