import "server-only";
import { headers } from "next/headers";
import { resolveSiteOrigin } from "@/lib/site-url";

/** Origin for links in e-mails and invitations (see lib/site-url.ts). */
export async function siteOrigin(): Promise<string> {
  const h = await headers();
  return resolveSiteOrigin(process.env, h.get("host"), h.get("x-forwarded-proto"));
}
