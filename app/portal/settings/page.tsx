import type { Metadata } from "next";
import { Suspense } from "react";
import { requireClient } from "@/lib/dal/session";
import { getMyPreferences, getOrgTimezone } from "@/lib/dal/portal";
import { formatDateTime } from "@/lib/format";
import { maskedPhone } from "@/lib/domain/portal";
import { PageHeader } from "@/components/layout/page-header";
import { DeviceNotificationsCard } from "@/components/pwa/device-notifications-card";
import { WhatsAppForm } from "@/components/portal/whatsapp-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Settings" };

export default function PortalSettingsPage() {
  return (
    <Suspense>
      <Settings />
    </Suspense>
  );
}

async function Settings() {
  const user = await requireClient();
  const [prefs, tz] = await Promise.all([getMyPreferences(user.id), getOrgTimezone(user.organizationId)]);
  const optIn = !!prefs?.whatsapp_opt_in;
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <PageHeader title="Settings" description={`${user.fullName || user.email} · ${user.organizationName}`} />
      <DeviceNotificationsCard description="Get a notification on this phone or computer when your cargo moves, the ETA changes or we need a document from you." />
      <Card>
        <CardHeader>
          <CardTitle>WhatsApp</CardTitle>
          <CardDescription>
            {optIn && prefs?.whatsapp_phone
              ? `On for ${maskedPhone(prefs.whatsapp_phone)}${prefs.consent_at ? ` since ${formatDateTime(prefs.consent_at, tz)}` : ""}.`
              : "Off. Turn it on to also get key updates on WhatsApp."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WhatsAppForm current={{ optIn, phone: prefs?.whatsapp_phone ?? null, consentAt: prefs?.consent_at ?? null }} />
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        Service messages about your account and documents we need are always shown in the portal. Messages are in English; more languages are coming.
      </p>
    </div>
  );
}
