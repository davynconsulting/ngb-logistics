import type { Metadata } from "next";
import { Suspense } from "react";
import { requireClient } from "@/lib/dal/session";
import { PageHeader } from "@/components/layout/page-header";
import { DeviceNotificationsCard } from "@/components/pwa/device-notifications-card";

export const metadata: Metadata = { title: "Settings" };

export default function PortalSettingsPage() {
  return (
    <Suspense>
      <Settings />
    </Suspense>
  );
}

async function Settings() {
  await requireClient();
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col">
      <PageHeader title="Settings" back={{ href: "/portal", label: "My shipments" }} />
      <DeviceNotificationsCard description="Get a notification on this phone or computer when your cargo moves, the ETA changes or we need a document from you." />
    </div>
  );
}
