import type { Metadata } from "next";
import { Suspense } from "react";
import { requireStaff } from "@/lib/dal/session";
import { PageHeader } from "@/components/layout/page-header";
import { DeviceNotificationsCard } from "@/components/pwa/device-notifications-card";

export const metadata: Metadata = { title: "My account" };

export default function AccountPage() {
  return (
    <Suspense>
      <Account />
    </Suspense>
  );
}

async function Account() {
  await requireStaff();
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col">
      <PageHeader title="My account" />
      <DeviceNotificationsCard description="Get alerts on this device when an exception you own is opened by the SLA check, an exception is escalated, or a client uploads a document." />
    </div>
  );
}
