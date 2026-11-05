import type { Metadata } from "next";
import { Suspense } from "react";
import { requireDriver } from "@/lib/dal/session";
import { PageHeader } from "@/components/layout/page-header";
import { DeviceNotificationsCard } from "@/components/pwa/device-notifications-card";

export const metadata: Metadata = { title: "Settings" };

export default function DriverSettingsPage() {
  return (
    <Suspense>
      <Settings />
    </Suspense>
  );
}

async function Settings() {
  const user = await requireDriver();
  return (
    <div className="flex flex-col gap-5">
      <PageHeader back={{ href: "/driver", label: "My jobs" }} title="Settings" description={user.fullName || user.email} />
      <DeviceNotificationsCard description="Get a notification on this phone when NGB needs something from you." />
    </div>
  );
}
