import type { ShipmentStatus } from "@/lib/domain/status-labels";
import { renderNotification, UnknownTemplateError } from "@/supabase/functions/_shared/notify/templates.ts";

/* Client portal helpers (pure; used by pages and tests). */

/** The journey a client sees, in six steps. */
export const JOURNEY: { label: string; statuses: ShipmentStatus[] }[] = [
  { label: "Booked", statuses: ["draft", "registered", "awaiting_documents"] },
  { label: "At port", statuses: ["vessel_arrived", "container_discharged", "port_processing", "ready_for_dispatch", "truck_assigned", "loading", "loaded"] },
  { label: "In transit", statuses: ["in_transit"] },
  { label: "Arrived", statuses: ["arrived"] },
  { label: "Delivered", statuses: ["delivered"] },
  { label: "Empty returned", statuses: ["container_returned", "operationally_complete", "closed"] },
];

export function journeyStep(status: ShipmentStatus): number {
  const i = JOURNEY.findIndex((s) => s.statuses.includes(status));
  return i < 0 ? 0 : i;
}

export const isActiveShipment = (status: ShipmentStatus) => !["operationally_complete", "closed"].includes(status);

/** Title, text and link for an inbox row (same texts as push/WhatsApp). */
export function inboxEntry(n: { template_key: string; payload: unknown; shipment_id: string | null }, timeZone: string) {
  try {
    const r = renderNotification({
      template_key: n.template_key, payload: (n.payload ?? {}) as Record<string, unknown>,
      shipment_id: n.shipment_id, timezone: timeZone,
    });
    return { title: r.title, body: r.body, url: safePortalPath(r.url) };
  } catch (e) {
    if (!(e instanceof UnknownTemplateError)) throw e;
    return { title: "Update", body: "There is an update on your account.", url: "/portal" };
  }
}

/** Links from notifications stay inside the app. */
export function safePortalPath(url: string): string {
  return url.startsWith("/") && !url.startsWith("//") && !url.includes("\\") ? url : "/portal";
}

/**
 * WhatsApp number → E.164. Accepts "+250 788 123 456", "00250788123456",
 * "(+254) 712-345-678". Local numbers without a country code are refused
 * (clients are in several countries).
 */
export function normalizePhone(input: string): string | null {
  let s = input.trim().replace(/[\s().-]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  return /^\+[1-9]\d{7,14}$/.test(s) ? s : null;
}

/** "+250788***456" for display. */
export const maskedPhone = (e164: string) => (e164.length > 7 ? `${e164.slice(0, 7)}***${e164.slice(-3)}` : e164);
