import { setMyContactSharing } from "@/lib/actions/driver";
import { Button } from "@/components/ui/button";

/** The driver's own choice to share name and phone with the client. Shown only if the client's policy allows it. */
export function ContactSharing({ assignmentId, shared, clientAllows }: { assignmentId: string; shared: boolean; clientAllows: boolean }) {
  if (!clientAllows) {
    return <p className="text-sm text-muted-foreground">This client does not receive driver contact details. Your name and phone stay with NGB.</p>;
  }
  return (
    <form action={setMyContactSharing.bind(null, assignmentId, !shared)} className="flex flex-col gap-3">
      <p className="text-sm">
        {shared
          ? "The client can see your name and phone number for this delivery."
          : "The client cannot see your name or phone number. You can choose to share them for this delivery."}
      </p>
      <Button type="submit" variant={shared ? "outline" : "default"} className="h-11 w-full sm:w-auto">
        {shared ? "Stop sharing my contact" : "Share my name and phone with the client"}
      </Button>
    </form>
  );
}
