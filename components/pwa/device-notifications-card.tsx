import { publicEnv } from "@/lib/env";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PushToggle } from "./push-toggle";

/** Card with the push on/off switch for the device in use. */
export function DeviceNotificationsCard({ description }: { description: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications on this device</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <PushToggle vapidPublicKey={publicEnv.NEXT_PUBLIC_VAPID_PUBLIC_KEY} />
      </CardContent>
    </Card>
  );
}
