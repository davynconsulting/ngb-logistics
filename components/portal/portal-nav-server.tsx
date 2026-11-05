import { getCurrentUser } from "@/lib/dal/session";
import { countUnread } from "@/lib/dal/portal";
import { PortalNav } from "./portal-nav";

/** Reads the unread count for the signed-in client. Render inside <Suspense>. */
export async function PortalNavWithCount() {
  const user = await getCurrentUser();
  if (!user || user.isStaff) return <PortalNav unread={0} />;
  return <PortalNav unread={await countUnread()} />;
}
